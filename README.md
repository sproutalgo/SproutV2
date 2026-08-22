# Sprout — Grassroots Crowdfunding on Algorand

Sprout is a **non-custodial** crowdfunding platform on Algorand. Each campaign is
backed by its own independent smart contract — funds are held by the contract,
never by the platform. Backers are refunded automatically if a campaign doesn't
reach its goal. Creators can run **reward campaigns** (backers receive a project
token) or **contribution campaigns** (no token distribution).

The founding thesis: Algorand has many capable builders with working projects but
no clean, honest path to community funding. Sprout is built to close that gap —
flat, transparent fees, no platform token, no cut of project tokens, and a
deliberate "backer, not investor" framing.

---

## Architecture

```
Algorand-Crowdfund/
├── contracts/              # Algorand Python (Puya) smart contract — funds source of truth
│   ├── crowdfund.py        # ARC4Contract (approval + clear compiled by puyapy)
│   ├── compile.py          # Runs puyapy -> approval.teal / clear.teal / Crowdfund.arc56.json
│   ├── Crowdfund.arc56.json# Compiled ARC-56 app spec (method selectors + state schema)
│   └── requirements.txt
├── frontend/               # React + Vite (deployed on Vercel)
│   └── src/
│       ├── components/     # Layout, ConnectWallet, ProjectCard, UI, ...
│       ├── pages/          # Home, ProjectDetail, CreateProject, MyProjects, ...
│       ├── utils/          # algorand.js, transactions.js (ARC-4 calls), api.js
│       └── context/        # ToastContext
└── backend/                # Node + Express API (deployed on Render)
    └── src/
        ├── routes/         # projects, health
        ├── services/       # projects (DB writes), sync (on-chain reconciliation)
        ├── middleware/     # auth (wallet-signature verification)
        ├── jobs/           # syncJob (scheduled chain->DB sync)
        └── utils/          # supabase, algorand, migrate
```

**Data model.** The smart contract holds authoritative on-chain state (goal,
raised, deadline, exchange rate, ASA). **Supabase (Postgres)** caches campaign
metadata and lifecycle flags for fast querying; the `sync` service reconciles the
cache against on-chain state. The frontend reads a mix of live chain state
(`gs.*`) and cached metadata (`meta.*`).

---

## Exchange rate (two-integer ratio)

Reward campaigns price tokens with **two whole integers**, not a single rate:

- `tpb` — tokens_per_bundle (whole tokens)
- `apb` — algo_per_bundle (whole ALGO)

Read as "**tpb tokens per apb ALGO**" (e.g. `1 token per 10 ALGO`). Payout floors
to whole tokens:

```
whole_tokens = floor( contribution_microALGO * tpb / (apb * 1,000,000) )
tokens_due   = whole_tokens * 10^ASA_decimals
```

So a contribution below the ratio rounds down (9 ALGO at 1-per-10 -> 0 tokens;
15 ALGO -> 1 token). `tpb == 0` signals a **contribution campaign** (no tokens). `apb`
is always >= 1 (it's a divisor). ASA decimals are read **on-chain** at setup and
stored as `dec_factor`; a setup-time overflow guard rejects token/rate/goal
combinations that would exceed uint64.

Rug-capable tokens are rejected at setup: an ASA with a **clawback** address,
**freeze** address, or **default-frozen** enabled cannot be used for a campaign.

---

## Contract calling convention (ARC-4)

The contract is an **Algorand Python (Puya) `ARC4Contract`**. Unlike the previous
PyTeal build (which dispatched on a raw string in `application_args[0]`), every
call is now an **ARC-4 ABI method call**:

- `appArgs[0]` is the 4-byte **method selector**
  (`sha512/256("name(argtypes)ret")[:4]`).
- `appArgs[1..]` are the ABI-encoded **non-transaction** arguments.
- **Transaction arguments** (the listing-fee `pay`, the setup `axfer`, the
  contribute `pay`) are **not** app-args. Under ARC-4 they are placed in the group
  **immediately before** the app call. So a contribute group is
  `[payment, appCall]` — the reverse of the old PyTeal `[appCall, payment]` order.
  The contract asserts `txn_arg.group_index == Txn.group_index - 1`.

The frontend never hard-codes selectors. `frontend/src/utils/transactions.js`
loads `contracts/Crowdfund.arc56.json` into an `algosdk.ABIContract` and reads
selectors, ABI arg types, and the **global state schema** (13 uints, 2 byte
slices) directly from the compiled spec, so client and contract can't drift.

---

## Smart contract flow

### Create (creator)
`CreateProject` sends an ARC-4 `create` call grouped with the listing-fee
payment, in group order `[listing-fee payment, ApplicationCreate]`. Method args:
admin address, goal (microAlgos), `tpb`, days, `apb`. The listing fee
(`goal * days / 100,000`, min 10 ALGO) is paid to the admin at creation.
Because the create call is at group index 1, the frontend confirms on the
create transaction's own id (`signAndConfirmGroup`) to read `application-index`.

### Setup (creator)
`MyProjects` -> "Set up contract" sends a 2-transaction group in ARC-4 order:
- `[0]` ASA transfer of the token pool into the app
  (`floor(goal * tpb / apb) * 10^decimals` base units)
- `[1]` AppCall `setup` (reads ASA decimals on-chain, enforces the overflow
  guard and clawback/freeze rejection, inner opt-in to the ASA)

Contribution campaigns (`tpb == 0`) skip setup entirely.

### Contribute (backer)
Opt in to the app, then send a 2-transaction group in ARC-4 order:
`[0]` a whole-ALGO payment, `[1]` AppCall `contribute` (contributions must be a
positive whole number of ALGO).

### Success — value moves immediately, close waits for grace
- Backers call `finalize` to receive their whole-token allocation.
- The creator calls `creator_claim` to withdraw the raised ALGO minus the 4% fee.
- The admin calls **`admin_fee_claim` to collect the 4% success fee immediately**
  once the campaign is funded — **no grace wait**, independent of the creator's
  claim, and callable exactly once (`admin_fee_claimed`).
- **Final close** (`admin_claim`, after the 6-month success grace) retires the
  stale contract. It returns the **residual ALGO to the creator**. If the admin
  never collected the fee, the close pays the outstanding 4% to the admin first,
  then closes the remainder to the creator (so the fee is never forfeited and
  never double-paid). Callable by **either the admin or the creator**.

### Failure — refunds immediate, close waits for grace
- Backers call `refund` to reclaim their ALGO in full.
- The creator calls `creator_reclaim_asa` to close the token pool back to
  themselves (`asa_id` resets to 0 while the campaign stays refundable).
- **Final close** (`admin_claim`, after the 6-month failure grace, measured from
  the deadline) closes any residual ALGO to the **creator**. No fee is ever taken
  on failure.

### ASA close-out ordering
`admin_claim` requires `asa_id == 0`, so any project-token holding must be closed
first (`creator_reclaim_asa` on failure, or `admin_sweep_asa` after the grace on
success). This keeps the ALGO close free of any inner asset transfer that could
revert and trap funds.

---

## Fees

- **Listing fee**: `goal * days / 100,000` (minimum 10 ALGO), paid at creation,
  non-refundable. Never enters the contract.
- **Success fee**: a fixed 4% of goal, collected by the admin via
  `admin_fee_claim` **as soon as the campaign is funded** (no grace wait,
  independent of the creator's claim, call-once). If left uncollected, the final
  grace close pays it to the admin before returning the remainder to the creator.
  No fee on failed campaigns.
- **Stale-contract close** returns residual ALGO to the **creator**, not the
  admin (the admin's only take is the 4% fee).
- No platform token, no cut of project tokens.

---

## Global state keys

| Key               | Type  | Description                                   |
|-------------------|-------|-----------------------------------------------|
| `goal`            | uint  | Funding goal (microAlgos, whole ALGO)         |
| `tpb`             | uint  | tokens_per_bundle (0 = donation campaign)     |
| `apb`             | uint  | algo_per_bundle (always >= 1)                 |
| `dec_factor`      | uint  | 10^ASA_decimals (set at setup, read on-chain) |
| `deadline`        | uint  | Deadline round                                |
| `days`            | uint  | Campaign duration in days                     |
| `asa_id`          | uint  | Project token ASA (0 until setup)             |
| `raised`          | uint  | Total raised (microAlgos)                     |
| `funded_round`    | uint  | Round the goal was first reached (0 if never) |
| `cancelled`       | uint  | Cancellation flag                             |
| `creator_claimed` | uint  | Creator payout claimed flag                   |
| `admin_fee_claimed`| uint | 4% success fee collected flag (new)           |
| `admin_claimed`   | uint  | Contract closed flag (final ALGO close)       |
| `creator`         | bytes | Creator address                               |
| `admin`           | bytes | Admin / fee-collection address                |

### Local state (per backer)

| Key       | Type | Description             |
|-----------|------|-------------------------|
| `contrib` | uint | Contributed microAlgos  |

---

## Quickstart (local / Codespaces)

### 1. Compile the contract
```bash
cd contracts
pip install -r requirements.txt          # installs puyapy + algorand-python
python compile.py                        # runs puyapy; writes approval.teal,
                                         # clear.teal, and Crowdfund.arc56.json
# (equivalent direct invocation: puyapy crowdfund.py)
```

The frontend imports all three artifacts, so re-run this whenever `crowdfund.py`
changes, then rebuild the frontend.

### 2. Backend
```bash
cd backend
npm install
# set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALGOD_SERVER, INDEXER_SERVER,
# ADMIN_ADDRESS in the environment (.env locally)
node src/utils/migrate.js         # applies the Supabase schema/migrations
npm run dev
```

### 3. Frontend
```bash
cd frontend
npm install
# set VITE_ALGOD_SERVER, VITE_INDEXER_SERVER, VITE_ADMIN_ADDRESS,
# VITE_WALLETCONNECT_PROJECT_ID, and (optional) VITE_NETWORK in the environment
npm run dev
```

Open `http://localhost:5173`. Connect with **Pera** or **Defly**.

---

## Testnet dry-run

A full lifecycle exercise on testnet. Set `VITE_NETWORK=testnet` (and testnet
algod/indexer URLs) for the frontend, and point the backend at testnet + a
throwaway Supabase project. Fund the creator, a backer, and the admin from the
[testnet dispenser](https://bank.testnet.algorand.network/).

1. **Compile & migrate.** `cd contracts && python compile.py`; then
   `node backend/src/utils/migrate.js` and run the printed SQL in Supabase
   (this now creates the `on_chain_admin_fee_claimed` column).
2. **Create** a reward campaign with a short duration (e.g. 1 day) so the
   deadline is reachable. Confirm the app deploys and `application-index` is read
   correctly (the create call is at group index 1 — this is the reordering most
   likely to break, so verify it first).
3. **Setup**: create or select a clean ASA (no clawback/freeze, not
   default-frozen) and fund the pool. Confirm the group posts as
   `[axfer, appCall]` and the inner opt-in succeeds.
4. **Contribute** from the backer up to the goal. Confirm the group posts as
   `[payment, appCall]`, `raised` increments, and `funded_round` gets set when the
   goal is reached.
5. **Success path**:
   - Backer `finalize` — receives whole-token allocation.
   - Creator `creator_claim` — receives 96%.
   - Admin `admin_fee_claim` ("Collect 4% fee" in the admin dashboard) — receives
     4% immediately, with no grace wait. Confirm the button flips to
     "Fee collected" and a second attempt is rejected.
6. **Grace close** (success): after `success_grace_expired`, run
   `admin_sweep_asa` (if any tokens remain) then `admin_claim`. Confirm the
   residual ALGO closes to the **creator**, and that `admin_claim` before grace
   surfaces the "grace not expired" message. The creator can also self-close via
   ProjectDetail's "Close & recover remaining ALGO".
7. **Failure path** (separate campaign, let the deadline pass without funding):
   backer `refund`, creator `creator_reclaim_asa`, then `admin_claim` after the
   failure grace — residual closes to the creator, no fee taken.

Because grace is ~6 months, use a local/private network with fast rounds or a
dev fixture to exercise steps 6–7 fully; on public testnet, verify the pre-grace
rejection path (the "grace not expired" message) rather than waiting it out.

---

## Contract integration

The frontend deploys the **real** contract — it imports the compiled
`contracts/approval.teal` and `contracts/clear.teal` (as raw text, see
`CreateProject.jsx`) and deploys them per campaign, and it imports
`contracts/Crowdfund.arc56.json` to build ARC-4 method calls. There is no stub.

To change the contract: edit `crowdfund.py` -> run `python contracts/compile.py`
-> **rebuild and redeploy the frontend** (the TEAL and ARC-56 spec are bundled at
build time, so a recompile alone doesn't change what deploys).

If you add or remove global state in the contract, the client-side create schema
updates automatically — it is read from the ARC-56 spec, not hard-coded — so a
recompile + frontend rebuild is all that's needed to keep them in sync.

> **AVM version:** puyapy emits `#pragma version 11` (the PyTeal build targeted
> v8). This is fine on current mainnet/testnet.

> **Mainnet note:** verify the timing constants `ROUNDS_PER_DAY` (30857) and
> `GRACE_PERIOD_ROUNDS` (5580866) hold their mainnet values before compiling a
> production build. Testnet values will make campaign deadlines meaningless.

---

## Environment variables

**Frontend** (`VITE_` vars are baked in at build time — a redeploy is required
to change them):

| Variable                        | Description                                    |
|---------------------------------|------------------------------------------------|
| `VITE_ALGOD_SERVER`             | Algod API URL (mainnet in production)          |
| `VITE_INDEXER_SERVER`           | Indexer API URL                                |
| `VITE_ALGOD_PORT` / `_TOKEN`    | Blank for AlgoNode                             |
| `VITE_ADMIN_ADDRESS`            | Platform admin / fee-collection address        |
| `VITE_WALLETCONNECT_PROJECT_ID` | WalletConnect Cloud project ID                 |
| `VITE_NETWORK`                  | `testnet` to override; defaults to mainnet     |

**Backend:**

| Variable                     | Description                          |
|------------------------------|--------------------------------------|
| `SUPABASE_URL`               | Supabase project URL                 |
| `SUPABASE_SERVICE_ROLE_KEY`  | Supabase service-role key            |
| `ALGOD_SERVER`               | Algod API URL                        |
| `INDEXER_SERVER`             | Indexer API URL                      |
| `ADMIN_ADDRESS`              | Must match the frontend admin address|

---

## Tech stack

- **Smart contract**: Algorand Python (Puya) on the Algorand AVM (ARC-4 / ARC-56)
- **Frontend**: React 18 + Vite (Vercel)
- **Backend**: Node + Express (Render)
- **Database**: Supabase (Postgres)
- **Wallets**: Pera, Defly via `@txnlab/use-wallet`
- **Algorand SDK**: algosdk v3
- **Explorer links**: Lora (AlgoKit)

---

## Notes

- `finalize` (claim tokens on success) and `refund` (reclaim ALGO on failure)
  are **self-service, one backer per call**: each backer calls the operation for
  their own address (`Txn.sender()`) from the project page. There is no admin
  batch step — backers pull their own tokens/refunds.
- Backend auth uses a signed 0-ALGO self-transaction (a challenge in the note
  field) to prove address ownership — works across all wallets and avoids
  `signBytes`. Signatures are resource-bound.
- Terminology is deliberately "backer," not "investor"; tokens are utility /
  early-access, not equity. This framing is intentional and load-bearing.

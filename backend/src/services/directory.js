import { supabase, supabasePublic } from '../utils/supabase.js'

// ─── Validation (mirrors the campaign field limits) ──────────────────────────
function validateEntry({ name, tagline, description, websiteUrl, highlights, category }) {
  if (!name || String(name).trim().length === 0) throw new Error('name is required')
  if (String(name).length > 60)                   throw new Error('name exceeds 60 characters')
  if (String(tagline || '').length > 120)         throw new Error('tagline exceeds 120 characters')
  if (String(description || '').length > 5000)    throw new Error('description exceeds 5000 characters')
  if (String(websiteUrl || '').length > 200)      throw new Error('websiteUrl exceeds 200 characters')
  if (String(category || '').length > 60)         throw new Error('category exceeds 60 characters')
  if (highlights != null) {
    if (!Array.isArray(highlights)) throw new Error('highlights must be a list')
    if (highlights.length > 3)      throw new Error('highlights cannot exceed 3 items')
    for (const h of highlights) {
      if (String(h || '').length > 500) throw new Error('each highlight exceeds 500 characters')
    }
  }
}

// ─── Read ────────────────────────────────────────────────────────────────────

// Public directory grid: approved entries only, newest first.
export async function getApprovedEntries({ page = 1, pageSize = 50 } = {}) {
  const from = (page - 1) * pageSize
  const to   = from + pageSize - 1
  const { data, error, count } = await supabasePublic
    .from('directory_entries')
    .select('*', { count: 'exact' })
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .range(from, to)
  if (error) throw error
  return { entries: data ?? [], total: count ?? 0 }
}

// A single entry by id (public — but callers should only surface approved ones).
export async function getEntry(id) {
  const { data, error } = await supabasePublic
    .from('directory_entries')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

// A poster's own entries (any status), so they can see pending/rejected too.
export async function getEntriesByWallet(walletAddress) {
  const { data, error } = await supabasePublic
    .from('directory_entries')
    .select('*')
    .eq('wallet_address', walletAddress)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// Admin review queue: pending entries, oldest first (FIFO review).
export async function getPendingEntries() {
  const { data, error } = await supabase
    .from('directory_entries')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

// ─── Write ───────────────────────────────────────────────────────────────────

// Submit a new entry (status defaults to 'pending'). walletAddress comes from the
// verified signature, never the request body.
export async function createEntry({ walletAddress, name, tagline, description, category, websiteUrl, imageUrl, highlights }) {
  validateEntry({ name, tagline, description, websiteUrl, highlights, category })

  const { data, error } = await supabase
    .from('directory_entries')
    .insert({
      wallet_address: walletAddress,
      name:           String(name).slice(0, 60),
      tagline:        String(tagline     || '').slice(0, 120),
      description:    String(description || '').slice(0, 5000),
      category:       category ? String(category).slice(0, 60) : null,
      website_url:    String(websiteUrl  || '').slice(0, 200),
      image_url:      imageUrl || '',
      highlights:     Array.isArray(highlights)
                        ? highlights.slice(0, 3).map(h => String(h || '').slice(0, 500))
                        : null,
      status:         'pending',
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// Edit an existing entry. OWNERSHIP-CHECKED: only the wallet that created the
// entry (verified via signature upstream) may edit it. Any edit resets status to
// 'pending' so the change is re-reviewed before going public again — this closes
// the bait-and-switch hole where an approved listing could be silently changed.
export async function updateEntry({ id, walletAddress, name, tagline, description, category, websiteUrl, imageUrl, highlights }) {
  validateEntry({ name, tagline, description, websiteUrl, highlights, category })

  // Fetch the entry first to verify ownership (service-role read, bypasses RLS).
  const { data: existing, error: fetchErr } = await supabase
    .from('directory_entries')
    .select('wallet_address')
    .eq('id', id)
    .single()
  if (fetchErr) throw fetchErr
  if (!existing) throw new Error('Entry not found')
  if (existing.wallet_address !== walletAddress) {
    const e = new Error('You can only edit your own listings')
    e.status = 403
    throw e
  }

  const { data, error } = await supabase
    .from('directory_entries')
    .update({
      name:         String(name).slice(0, 60),
      tagline:      String(tagline     || '').slice(0, 120),
      description:  String(description || '').slice(0, 5000),
      category:     category ? String(category).slice(0, 60) : null,
      website_url:  String(websiteUrl  || '').slice(0, 200),
      image_url:    imageUrl || '',
      highlights:   Array.isArray(highlights)
                      ? highlights.slice(0, 3).map(h => String(h || '').slice(0, 500))
                      : null,
      status:       'pending',          // edits always re-enter review
      reviewed_at:  null,
      reviewed_by:  null,
      updated_at:   new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

// Admin: approve or reject a pending entry.
export async function setEntryStatus({ id, status, adminAddress }) {
  if (status !== 'approved' && status !== 'rejected') {
    throw new Error('status must be "approved" or "rejected"')
  }
  const { data, error } = await supabase
    .from('directory_entries')
    .update({
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: adminAddress,
      updated_at:  new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

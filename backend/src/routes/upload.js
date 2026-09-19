import { Router } from 'express'
import multer from 'multer'
import crypto from 'crypto'
import { supabase } from '../utils/supabase.js'

const router = Router()

// ── Config ───────────────────────────────────────────────────────────────────
const BUCKET = process.env.SUPABASE_IMAGE_BUCKET || 'campaign-images'
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB — matches the bucket-level limit
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])
const EXT_FOR_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

// Multer with in-memory storage + hard size cap. This is SERVER-SIDE enforcement:
// the browser also checks, but this is the real ceiling. MIME is checked below
// against the parsed buffer, not just the client-declared type, where possible.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('Only PNG, JPG, or WebP images are allowed.'))
    }
    cb(null, true)
  },
})

// Basic magic-byte sniff as defence-in-depth: don't trust the client's declared
// MIME alone. Confirms the bytes actually look like the format claimed.
function sniffMime(buf) {
  if (buf.length < 12) return null
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  // WEBP: "RIFF"...."WEBP"
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return null
}

// POST /api/upload/campaign-image  (multipart/form-data, field name "image")
router.post('/campaign-image', (req, res) => {
  upload.single('image')(req, res, async (err) => {
    // Multer errors (size, count, filter) land here.
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'Image is too large. Maximum size is 2 MB.'
        : (err.message || 'Upload failed.')
      return res.status(400).json({ error: msg })
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided (field name must be "image").' })
    }

    const buf = req.file.buffer

    // Confirm the bytes match an allowed format (not just the declared MIME).
    const sniffed = sniffMime(buf)
    if (!sniffed || !ALLOWED_MIME.has(sniffed)) {
      return res.status(400).json({ error: 'File does not appear to be a valid PNG, JPG, or WebP image.' })
    }

    const ext = EXT_FOR_MIME[sniffed]
    // Random, collision-resistant object name. No user-controlled path segments.
    const objectName = `${crypto.randomUUID()}.${ext}`

    try {
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(objectName, buf, {
          contentType: sniffed,
          cacheControl: '31536000', // 1 year — images are immutable (unique name)
          upsert: false,
        })
      if (upErr) {
        console.error('[upload] storage error:', upErr)
        return res.status(502).json({ error: 'Storage upload failed. Please try again.' })
      }

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(objectName)
      return res.json({ url: data.publicUrl, path: objectName })
    } catch (e) {
      console.error('[upload] unexpected error:', e)
      return res.status(500).json({ error: 'Unexpected error during upload.' })
    }
  })
})

export default router

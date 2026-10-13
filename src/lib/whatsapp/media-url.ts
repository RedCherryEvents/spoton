const VIDEO_PAGE_HOSTS: Record<string, string> = {
  'youtube.com': 'YouTube',
  'm.youtube.com': 'YouTube',
  'music.youtube.com': 'YouTube',
  'youtu.be': 'YouTube',
  'vimeo.com': 'Vimeo',
  'player.vimeo.com': 'Vimeo',
}

/**
 * Name of the video site when `url` is a watch page rather than a media
 * file. WhatsApp downloads media links itself and needs the file (MP4,
 * JPEG, PDF…); a watch page returns HTML, so Meta accepts the send and
 * the message then fails to deliver. Such links belong in a text message.
 * Null for anything else, including URLs still holding {{ variables }}.
 */
export function videoPageSite(url: string): string | null {
  const raw = url.trim()
  if (!raw || raw.includes('{{')) return null
  let host: string
  try {
    host = new URL(raw).hostname.toLowerCase()
  } catch {
    return null
  }
  return VIDEO_PAGE_HOSTS[host.replace(/^www\./, '')] ?? null
}

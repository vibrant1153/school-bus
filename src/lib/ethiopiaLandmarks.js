/**
 * Curated Landmarks & Transit Hubs for Addis Ababa and Ethiopia.
 * Allows school managers to add stops by simply picking familiar landmarks
 * without needing to know or type raw latitude/longitude coordinates.
 */

export const ETHIOPIA_LANDMARKS = [
  // ── Bole / Atlas / Olympia / Bulbula ──
  { name: 'Bole Medhanealem Church Gate', lat: 9.0010, lng: 38.7845, area: 'Bole' },
  { name: 'Atlas Hotel / Shala Park', lat: 9.0125, lng: 38.7750, area: 'Atlas' },
  { name: 'Rwanda Embassy Roundabout', lat: 9.0180, lng: 38.7700, area: 'Bole' },
  { name: 'Edna Mall / Japan Embassy Junction', lat: 9.0035, lng: 38.7860, area: 'Bole' },
  { name: 'Bole Bras Hospital Junction', lat: 9.0080, lng: 38.7820, area: 'Bole' },
  { name: 'Olympia Roundabout / Dembel', lat: 9.0060, lng: 38.7690, area: 'Olympia' },
  { name: 'Bole Bulbula Roundabout', lat: 8.9750, lng: 38.7850, area: 'Bole Bulbula' },
  { name: 'Bole Michael Church Gate', lat: 8.9880, lng: 38.7720, area: 'Bole Michael' },
  { name: 'Friendship City Center Gate', lat: 8.9950, lng: 38.7860, area: 'Bole' },
  { name: 'Morning Star Mall / Millennium Hall', lat: 8.9930, lng: 38.7890, area: 'Bole' },

  // ── CMC / Megenagna / Gurd Shola / Summit / Ayat ──
  { name: 'CMC Michael Square / Roundabout', lat: 9.0255, lng: 38.8350, area: 'CMC' },
  { name: 'Megenagna Station / Zefmesh Mall', lat: 9.0185, lng: 38.8020, area: 'Megenagna' },
  { name: 'Signal / British Embassy Junction', lat: 9.0220, lng: 38.7800, area: 'Signal' },
  { name: 'Summit Condominium Gate', lat: 9.0120, lng: 38.8550, area: 'Summit' },
  { name: 'Ayat Roundabout / Real Estate Gate', lat: 9.0300, lng: 38.8650, area: 'Ayat' },
  { name: 'Gurd Shola / Athletics Federation', lat: 9.0210, lng: 38.8180, area: 'Gurd Shola' },
  { name: 'Kotebe 02 / Teachers College Gate', lat: 9.0330, lng: 38.8400, area: 'Kotebe' },
  { name: 'Gerji Imperial Hotel Junction', lat: 9.0040, lng: 38.8030, area: 'Gerji' },
  { name: 'Gerji Mebrat Hayil Roundabout', lat: 8.9950, lng: 38.8150, area: 'Gerji' },
  { name: 'Gerji Unity University Gate', lat: 8.9980, lng: 38.8120, area: 'Gerji' },
  { name: 'Jackros / Meta Brewery Junction', lat: 9.0060, lng: 38.8300, area: 'Gerji' },

  // ── Sarbet / Mexico / Bisrate Gabriel / Old Airport ──
  { name: 'Sarbet Laphto Mall Roundabout', lat: 9.0020, lng: 38.7360, area: 'Sarbet' },
  { name: 'Bisrate Gabriel Church Junction', lat: 8.9950, lng: 38.7320, area: 'Bisrate Gabriel' },
  { name: 'Mexico Square / Kera Junction', lat: 9.0100, lng: 38.7450, area: 'Mexico' },
  { name: 'Old Airport / ICS School Gate', lat: 8.9910, lng: 38.7300, area: 'Old Airport' },
  { name: 'Tor Hailoch Roundabout', lat: 9.0145, lng: 38.7280, area: 'Tor Hailoch' },
  { name: 'Lebu Varnero Square / Roundabout', lat: 8.9720, lng: 38.7350, area: 'Lebu' },
  { name: 'Jemo 1 Roundabout', lat: 8.9680, lng: 38.7180, area: 'Jemo' },
  { name: 'Jemo 3 Glass Factory Gate', lat: 8.9550, lng: 38.7120, area: 'Jemo' },
  { name: 'Gotera Interchange / Pepsu Gate', lat: 9.0010, lng: 38.7560, area: 'Gotera' },
  { name: 'Kera / Bulgarian Embassy Road', lat: 9.0050, lng: 38.7480, area: 'Kera' },
  { name: 'Saris Abo Church Gate', lat: 8.9750, lng: 38.7650, area: 'Saris' },
  { name: 'Kality Roundabout / Total Station', lat: 8.9350, lng: 38.7620, area: 'Kality' },

  // ── Kazanchis / 22 Mazoria / Piassa / Arat Kilo / Sidist Kilo ──
  { name: 'Kazanchis UNECA / Intercontinental Gate', lat: 9.0150, lng: 38.7660, area: 'Kazanchis' },
  { name: '22 Mazoria / Golagol Tower', lat: 9.0140, lng: 38.7880, area: '22 Mazoria' },
  { name: 'Urael Church Roundabout', lat: 9.0130, lng: 38.7780, area: 'Urael' },
  { name: 'Arat Kilo Square / Ministry of Education', lat: 9.0350, lng: 38.7630, area: '4 Kilo' },
  { name: 'Sidist Kilo Square (Yekatit 12 Monument)', lat: 9.0480, lng: 38.7620, area: '6 Kilo' },
  { name: 'Piassa / De Gaulle Square (Churchill Ave)', lat: 9.0320, lng: 38.7510, area: 'Piassa' },
  { name: 'Shiro Meda Market Gate', lat: 9.0620, lng: 38.7640, area: 'Shiro Meda' },
  { name: 'Gullele / St. Paul Hospital Gate', lat: 9.0550, lng: 38.7350, area: 'Gullele' },
  { name: 'Merkato / Raguel Church Gate', lat: 9.0330, lng: 38.7360, area: 'Merkato' },
  { name: 'Autobis Tera / Grand Anwar Mosque Gate', lat: 9.0280, lng: 38.7380, area: 'Merkato' },

  // ── Hawassa, Adama, Bahir Dar, Dire Dawa Hubs ──
  { name: 'Hawassa Piazza / Central Roundabout', lat: 7.0504, lng: 38.4955, area: 'Hawassa' },
  { name: 'Adama Posta Bet Square', lat: 8.5400, lng: 39.2700, area: 'Adama' },
  { name: 'Bahir Dar Kebele 04 Square', lat: 11.5950, lng: 37.3900, area: 'Bahir Dar' },
  { name: 'Dire Dawa Taiwan Market Gate', lat: 9.5930, lng: 41.8660, area: 'Dire Dawa' },
]

/**
 * Quick popular presets shown as 1-tap chips
 */
export const QUICK_CHIP_LANDMARKS = [
  'Bole Medhanealem Church Gate',
  'Atlas Hotel / Shala Park',
  'CMC Michael Square / Roundabout',
  'Megenagna Station / Zefmesh Mall',
  'Sarbet Laphto Mall Roundabout',
  'Bisrate Gabriel Church Junction',
  'Mexico Square / Kera Junction',
  'Kazanchis UNECA / Intercontinental Gate',
  'Gerji Imperial Hotel Junction',
  'Summit Condominium Gate',
  'Ayat Roundabout / Real Estate Gate',
  'Tor Hailoch Roundabout',
]

/**
 * Searches local Ethiopian landmarks first (instant, 0ms, offline-safe).
 * If not found, attempts free OpenStreetMap Nominatim geocoding in Addis Ababa.
 */
export async function lookupEthiopiaLocation(query) {
  if (!query || !query.trim()) return null
  const clean = query.trim().toLowerCase()

  // 1. Try local curated match
  const localMatch = ETHIOPIA_LANDMARKS.find((l) =>
    l.name.toLowerCase().includes(clean) ||
    clean.includes(l.name.toLowerCase()) ||
    clean.split(' ').every((w) => l.name.toLowerCase().includes(w) || l.area.toLowerCase().includes(w))
  )

  if (localMatch) {
    return {
      name: localMatch.name,
      lat: localMatch.lat,
      lng: localMatch.lng,
      source: 'preset',
    }
  }

  // 2. Try online OpenStreetMap Nominatim geocoding in Addis Ababa
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      query + ', Addis Ababa, Ethiopia'
    )}&limit=1`

    const res = await fetch(url, {
      headers: {
        'Accept-Language': 'en,am',
      },
    })
    if (!res.ok) return null

    const data = await res.json()
    if (Array.isArray(data) && data.length > 0) {
      const best = data[0]
      return {
        name: best.display_name?.split(',')?.[0] || query,
        lat: parseFloat(best.lat),
        lng: parseFloat(best.lon),
        source: 'nominatim',
      }
    }
  } catch (err) {
    console.warn('Online geocoding failed, using area fallback:', err)
  }

  return null
}

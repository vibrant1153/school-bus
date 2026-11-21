/**
 * Robust CSV, TSV, and JSON file parser for school student roster imports.
 * Zero external dependencies, supports RFC 4180 quotes, semicolons, tabs, and UTF-8 BOM.
 */

// Common header aliases
const ALIASES = {
  fullName: [
    'student name', 'student_name', 'name', 'full name', 'full_name',
    'student', 'child', 'child name', 'child_name', 'ተማሪ', 'የተማሪ ስም',
  ],
  grade: [
    'grade', 'class', 'grade level', 'grade_level', 'level', 'ክፍል', 'ደረጃ',
  ],
  parentPhone: [
    'parent phone', 'parent_phone', 'phone', 'phone number', 'phone_number',
    'mobile', 'contact', 'parent contact', 'parent_contact', 'guardian phone',
    'guardian_phone', 'cell', 'ስልክ', 'የወላጅ ስልክ',
  ],
  routeName: [
    'route', 'route name', 'route_name', 'bus route', 'bus_route', 'bus', 'መስመር',
  ],
  stopName: [
    'stop', 'stop name', 'stop_name', 'bus stop', 'bus_stop', 'station',
    'pickup stop', 'pickup_stop', 'dropoff stop', 'ማቆሚያ',
  ],
}

/**
 * Normalizes phone numbers to Ethiopian format (+251...) or clean international format
 */
export function normalizePhone(rawPhone) {
  if (!rawPhone) return ''
  const str = String(rawPhone).trim()
  let digits = str.replace(/\D/g, '')

  if (digits.startsWith('09') || digits.startsWith('07')) {
    digits = '251' + digits.slice(1)
  } else if ((digits.startsWith('9') || digits.startsWith('7')) && digits.length === 9) {
    digits = '251' + digits
  }

  if (digits.startsWith('251') && digits.length === 12) {
    return `+${digits}`
  }

  return str.startsWith('+') ? `+${digits}` : digits
}

/**
 * Parses raw CSV/TSV text into an array of rows and columns, handling quotes and line breaks.
 */
function parseDelimitedText(text, explicitDelimiter) {
  // Strip UTF-8 BOM if present
  let cleanText = text.replace(/^\uFEFF/, '').trim()
  if (!cleanText) return []

  // Auto-detect delimiter if not explicit
  let delimiter = explicitDelimiter
  if (!delimiter) {
    const firstLine = cleanText.split(/\r\n|\n|\r/)[0] || ''
    const commaCount = (firstLine.match(/,/g) || []).length
    const tabCount = (firstLine.match(/\t/g) || []).length
    const semiCount = (firstLine.match(/;/g) || []).length

    if (tabCount > commaCount && tabCount > semiCount) {
      delimiter = '\t'
    } else if (semiCount > commaCount) {
      delimiter = ';'
    } else {
      delimiter = ','
    }
  }

  const rows = []
  let currentRow = []
  let currentField = ''
  let inQuotes = false

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i]
    const nextChar = cleanText[i + 1]

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote: "" -> "
          currentField += '"'
          i++
        } else {
          // Closing quote
          inQuotes = false
        }
      } else {
        currentField += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === delimiter) {
        currentRow.push(currentField.trim())
        currentField = ''
      } else if (char === '\r') {
        if (nextChar === '\n') i++
        currentRow.push(currentField.trim())
        rows.push(currentRow)
        currentRow = []
        currentField = ''
      } else if (char === '\n') {
        currentRow.push(currentField.trim())
        rows.push(currentRow)
        currentRow = []
        currentField = ''
      } else {
        currentField += char
      }
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim())
    rows.push(currentRow)
  }

  return rows.filter((r) => r.some((cell) => cell.length > 0))
}

/**
 * Matches raw header strings to normalized field keys.
 */
function identifyHeaders(headerRow) {
  const mapping = {} // colIndex -> 'fullName' | 'grade' | 'parentPhone' | 'routeName' | 'stopName'

  headerRow.forEach((col, idx) => {
    const clean = String(col).toLowerCase().replace(/[\-_]/g, ' ').trim()
    for (const [key, aliases] of Object.entries(ALIASES)) {
      if (aliases.some((alias) => clean === alias || clean.includes(alias))) {
        if (!Object.values(mapping).includes(key)) {
          mapping[idx] = key
        }
      }
    }
  })

  // Fallback defaults if first row wasn't headers or headers were unmatched
  if (mapping[0] === undefined && headerRow[0]) mapping[0] = 'fullName'
  if (mapping[1] === undefined && headerRow[1]) mapping[1] = 'grade'
  if (mapping[2] === undefined && headerRow[2]) mapping[2] = 'parentPhone'

  return mapping
}

/**
 * Parses an uploaded File object (CSV, TSV, TXT, or JSON).
 * Matches stops and routes against school configuration.
 */
export async function parseStudentFile(file, routes = []) {
  const text = await file.text()
  const isJson = file.name.endsWith('.json') || text.trim().startsWith('[')

  let parsedRawRecords = []

  if (isJson) {
    try {
      const jsonData = JSON.parse(text)
      if (Array.isArray(jsonData)) {
        parsedRawRecords = jsonData.map((item) => ({
          fullName: item.fullName || item.name || item.student_name || item.student || '',
          grade: item.grade || item.class || '',
          parentPhone: item.parentPhone || item.phone || item.parent_phone || '',
          routeName: item.routeName || item.route || item.bus || '',
          stopName: item.stopName || item.stop || item.bus_stop || '',
        }))
      }
    } catch (err) {
      throw new Error('Invalid JSON format: ' + err.message)
    }
  } else {
    const rawRows = parseDelimitedText(text)
    if (rawRows.length < 1) {
      throw new Error('The uploaded file appears to be empty.')
    }

    const headerMapping = identifyHeaders(rawRows[0])
    const dataRows = rawRows.slice(1)

    parsedRawRecords = dataRows.map((row) => {
      const record = { fullName: '', grade: '', parentPhone: '', routeName: '', stopName: '' }
      row.forEach((val, idx) => {
        const key = headerMapping[idx]
        if (key) {
          record[key] = val
        }
      })
      return record
    })
  }

  // Flatten all stops from existing routes for quick lookup
  const allStops = []
  routes.forEach((r) => {
    (r.stops || []).forEach((st) => {
      allStops.push({
        id: st.id,
        name: st.name,
        routeId: r.id,
        routeName: r.name,
      })
    })
  })

  // Process & validate rows
  const processedRows = parsedRawRecords.map((r, index) => {
    const fullName = String(r.fullName || '').trim()
    const rawGrade = String(r.grade || '').trim()
    const cleanPhone = normalizePhone(r.parentPhone)
    const targetRouteName = String(r.routeName || '').trim().toLowerCase()
    const targetStopName = String(r.stopName || '').trim().toLowerCase()

    let matchedStop = null
    if (targetStopName && allStops.length > 0) {
      // 1. Exact match on stop name
      matchedStop = allStops.find((st) => st.name.toLowerCase() === targetStopName)
      // 2. Partial match if not exact
      if (!matchedStop) {
        matchedStop = allStops.find((st) => st.name.toLowerCase().includes(targetStopName))
      }
    }

    // Determine status and warnings
    let status = 'valid' // 'valid' | 'warning' | 'error'
    const issues = []

    if (!fullName) {
      status = 'error'
      issues.push('Missing student name')
    }

    if (!cleanPhone) {
      if (status !== 'error') status = 'warning'
      issues.push('No parent phone')
    }

    if (targetStopName && !matchedStop) {
      if (status !== 'error') status = 'warning'
      issues.push(`Unmatched stop: "${r.stopName}"`)
    }

    let parsedGrade = null
    const gradeNum = parseInt(rawGrade.replace(/\D/g, ''), 10)
    if (!isNaN(gradeNum)) {
      parsedGrade = gradeNum
    } else if (rawGrade.toLowerCase().startsWith('k')) {
      parsedGrade = 0
    }

    return {
      index: index + 1,
      fullName,
      grade: parsedGrade,
      rawGrade,
      parentPhone: cleanPhone,
      rawPhone: r.parentPhone,
      targetStopName: r.stopName,
      matchedStopId: matchedStop ? matchedStop.id : null,
      matchedStopName: matchedStop ? matchedStop.name : null,
      matchedRouteName: matchedStop ? matchedStop.routeName : null,
      status,
      issues,
    }
  }).filter((r) => r.fullName || r.parentPhone || r.rawGrade) // Drop completely blank trailing lines

  const totalCount = processedRows.length
  const validCount = processedRows.filter((r) => r.status === 'valid').length
  const warningCount = processedRows.filter((r) => r.status === 'warning').length
  const errorCount = processedRows.filter((r) => r.status === 'error').length

  return {
    rows: processedRows,
    totalCount,
    validCount,
    warningCount,
    errorCount,
  }
}

/**
 * Downloads a sample CSV template for the school manager.
 */
export function downloadStudentTemplateCsv(routes = []) {
  const exampleStop = routes[0]?.stops?.[0]?.name || 'Bole Medhanealem Gate'
  const exampleRoute = routes[0]?.name || 'Route 1'

  const csvContent = [
    'Student Name,Grade,Parent Phone,Route Name,Stop Name',
    `Abebe Bekele,4,0911223344,${exampleRoute},${exampleStop}`,
    `Sara Hailu,2,+251912345678,${exampleRoute},${exampleStop}`,
    'Yonas Tadesse,5,0922334455,,',
    'Hana Girma,Kindergarten,0933445566,,',
  ].join('\r\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', 'school_students_template.csv')
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Downloads generated parent invitation links as CSV.
 */
export function downloadInvitesCsv(invitations, schoolName = 'School') {
  if (!invitations || invitations.length === 0) return

  const header = 'Student Name,Parent Phone,Invitation Link,Expires At'
  const lines = invitations.map((inv) =>
    `"${(inv.studentName || '').replace(/"/g, '""')}","${inv.phoneNumber || ''}","${inv.url || ''}","${inv.expiresAt || ''}"`
  )
  const csvContent = [header, ...lines].join('\r\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  const safeSchoolName = schoolName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()
  link.setAttribute('download', `${safeSchoolName}_parent_invitation_links.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

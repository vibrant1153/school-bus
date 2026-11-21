import { parseStudentFile, normalizePhone } from '../src/lib/fileParser.js'

async function test() {
  console.log('Testing phone normalization...')
  console.assert(normalizePhone('0911223344') === '+251911223344', 'Failed 09')
  console.assert(normalizePhone('+251 91 122 3344') === '+251911223344', 'Failed +251 with spaces')
  console.assert(normalizePhone('0712345678') === '+251712345678', 'Failed 07')
  console.log('✓ Phone normalization passed')

  const mockRoutes = [
    {
      id: 'r1',
      name: 'Route 1 - Bole',
      stops: [
        { id: 's1', name: 'Bole Medhanealem Gate' },
        { id: 's2', name: 'Atlas Hotel' },
      ],
    },
  ]

  // Test 1: Standard CSV with quotes
  const csvContent = `Student Name,Grade,Parent Phone,Route,Stop
"Bekele, Yonas",4,0911223344,Route 1,Bole Medhanealem Gate
Sara Hailu,Kindergarten,+251922334455,Route 1,Atlas
Dawit Kebede,Grade 6,0933445566,,`

  const mockFile = {
    name: 'roster.csv',
    text: async () => csvContent,
  }

  const result = await parseStudentFile(mockFile, mockRoutes)
  console.log('Parsed rows:', result.totalCount)
  console.assert(result.totalCount === 3, 'Expected 3 rows')
  console.assert(result.rows[0].fullName === 'Bekele, Yonas', 'Failed quoted name parse')
  console.assert(result.rows[0].grade === 4, 'Failed grade 4')
  console.assert(result.rows[0].matchedStopId === 's1', 'Failed stop match s1')
  console.assert(result.rows[1].grade === 0, 'Failed kindergarten grade')
  console.assert(result.rows[1].matchedStopId === 's2', 'Failed partial stop match s2')
  console.assert(result.rows[2].grade === 6, 'Failed grade 6')
  console.log('✓ CSV parsing & stop matching passed cleanly!')

  // Test 2: Tab-separated (Excel export)
  const tsvContent = `ተማሪ\tክፍል\tስልክ
አበበ ከበደ\t3\t0911000000`
  const mockTsv = {
    name: 'roster.tsv',
    text: async () => tsvContent,
  }
  const tsvResult = await parseStudentFile(mockTsv, mockRoutes)
  console.assert(tsvResult.rows[0].fullName === 'አበበ ከበደ', 'Failed Amharic name')
  console.assert(tsvResult.rows[0].grade === 3, 'Failed Amharic grade')
  console.assert(tsvResult.rows[0].parentPhone === '+251911000000', 'Failed Amharic phone')
  console.log('✓ TSV & Amharic headers passed cleanly!')
}

test().catch((err) => {
  console.error('Test failed:', err)
  process.exit(1)
})

// PROTOTYPE ONLY: sample school data. Real data comes from the database later.
// Every name here is invented. Never put real children in test data.

export const BUSES = [
  { id: 'b1', name: 'Bus 1', plate: 'TEST-001', driver: 'Driver A', routeId: 'a' },
  { id: 'b2', name: 'Bus 2', plate: 'TEST-002', driver: 'Driver B', routeId: 'b' },
  { id: 'b3', name: 'Bus 3', plate: 'TEST-003', driver: null, routeId: 'c' },
]

// Stops are listed in morning order. The last stop is the school.
export const ROUTES = [
  {
    id: 'a', name: 'Route A', startTime: '6:45 AM',
    stops: [
      { id: 'a1', name: 'Green Park Gate', hasPin: true },
      { id: 'a2', name: 'Market Corner', hasPin: true },
      { id: 'a3', name: 'Church Road', hasPin: true },
      { id: 'a4', name: 'Clinic Junction', hasPin: false },
      { id: 'a5', name: 'School gate', hasPin: true, isSchool: true },
    ],
  },
  {
    id: 'b', name: 'Route B', startTime: '6:50 AM',
    stops: [
      { id: 'b1', name: 'Bakery Lane', hasPin: true },
      { id: 'b2', name: 'Water Tower', hasPin: true },
      { id: 'b3', name: 'Sports Field', hasPin: true },
      { id: 'b4', name: 'School gate', hasPin: true, isSchool: true },
    ],
  },
  {
    id: 'c', name: 'Route C', startTime: '7:00 AM',
    stops: [
      { id: 'c1', name: 'Hill View', hasPin: true },
      { id: 'c2', name: 'Post Office', hasPin: true },
      { id: 'c3', name: 'School gate', hasPin: true, isSchool: true },
    ],
  },
]

export const STUDENTS = [
  { id: 1, name: 'Student A (sample)', grade: 3, routeId: 'a', stopId: 'a4', parent: 'Mrs. Test Parent · 09•• ••• 321' },
  { id: 2, name: 'Student B (sample)', grade: 5, routeId: 'a', stopId: 'a2', parent: 'Mr. Test Guardian · 09•• ••• 114' },
  { id: 3, name: 'Student C (sample)', grade: 2, routeId: 'b', stopId: null, parent: 'test.parent@example.com' },
  { id: 4, name: 'Student D (sample)', grade: 6, routeId: 'c', stopId: 'c1', parent: 'Mrs. Sample Two · 09•• ••• 780' },
  { id: 5, name: 'Student E (sample)', grade: 1, routeId: 'b', stopId: 'b3', parent: '2 parents linked' },
  { id: 6, name: 'Student F (sample)', grade: 4, routeId: 'a', stopId: 'a1', parent: 'sample.f@example.com' },
  { id: 7, name: 'Student G (sample)', grade: 4, routeId: 'a', stopId: 'a1', parent: 'Mr. Sample Three · 09•• ••• 502' },
  { id: 8, name: 'Student H (sample)', grade: 3, routeId: 'a', stopId: null, parent: 'Mrs. Sample Four · 09•• ••• 667' },
  { id: 9, name: 'Student I (sample)', grade: 5, routeId: 'b', stopId: 'b1', parent: 'sample.i@example.com' },
  { id: 10, name: 'Student J (sample)', grade: 2, routeId: 'c', stopId: 'c2', parent: 'Mr. Sample Five · 09•• ••• 245' },
  { id: 11, name: 'Student K (sample)', grade: 6, routeId: 'c', stopId: null, parent: 'sample.k@example.com' },
  { id: 12, name: 'Student L (sample)', grade: 1, routeId: 'b', stopId: 'b2', parent: 'Mrs. Sample Six · 09•• ••• 903' },
]

export const TRIPS = [
  { id: 't1', busId: 'b1', direction: 'Morning', status: 'in_progress', lastSeen: '6 sec ago' },
  { id: 't2', busId: 'b2', direction: 'Morning', status: 'in_progress', lastSeen: 'Silent for 7 min', problem: true, silentMinutes: 7 },
  { id: 't3', busId: 'b3', direction: 'Morning', status: 'scheduled', startsAt: '7:00 AM', lastSeen: 'Not started' },
  { id: 't4', busId: 'b1', direction: 'Afternoon', status: 'scheduled', startsAt: '4:00 PM', lastSeen: 'Not started' },
  { id: 't5', busId: 'b2', direction: 'Afternoon', status: 'scheduled', startsAt: '4:00 PM', lastSeen: 'Not started' },
  { id: 't6', busId: 'b3', direction: 'Afternoon', status: 'scheduled', startsAt: '4:00 PM', lastSeen: 'Not started' },
]

export const busById = (id) => BUSES.find((b) => b.id === id)
export const routeById = (id) => ROUTES.find((r) => r.id === id)
export const stopById = (id) => ROUTES.flatMap((r) => r.stops).find((s) => s.id === id)
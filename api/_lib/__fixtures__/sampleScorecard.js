// Realistic 18-hole scorecard fixture based on typical championship course data.
// Used by integration tests for the PDF parsing pipeline.

export const SAMPLE_COURSE_NAME = 'Pine Valley Golf Club'
export const SAMPLE_LOCATION = 'Pine Valley, NJ'

// 18-hole scorecard from the championship tees
export const SAMPLE_SCORECARD = {
  name: 'Pine Valley Golf Club',
  location: 'Pine Valley, NJ',
  yardage: 6765,
  rating: 73.4,
  slope: 145,
  par: 70,
  selectedTee: 'Championship',
  source: 'PDF (uploaded yardage book)',
  _confidence: 'high',
  tees: [
    {
      name: 'Championship', color: 'black', yardage: 6765, rating: 73.4, slope: 145, par: 70,
      holes: [
        { par: 4, yardage: 427, handicap: 5 },
        { par: 4, yardage: 367, handicap: 11 },
        { par: 3, yardage: 185, handicap: 15 },
        { par: 4, yardage: 461, handicap: 1 },
        { par: 3, yardage: 232, handicap: 9 },
        { par: 4, yardage: 391, handicap: 7 },
        { par: 5, yardage: 585, handicap: 3 },
        { par: 4, yardage: 327, handicap: 17 },
        { par: 4, yardage: 432, handicap: 13 },
        { par: 4, yardage: 386, handicap: 10 },
        { par: 4, yardage: 399, handicap: 4 },
        { par: 3, yardage: 166, handicap: 18 },
        { par: 4, yardage: 448, handicap: 2 },
        { par: 4, yardage: 392, handicap: 6 },
        { par: 5, yardage: 591, handicap: 8 },
        { par: 3, yardage: 146, handicap: 16 },
        { par: 4, yardage: 344, handicap: 14 },
        { par: 4, yardage: 486, handicap: 12 },
      ],
    },
    {
      name: 'Blue', color: 'blue', yardage: 6350, rating: 71.2, slope: 139, par: 70,
      holes: [
        { par: 4, yardage: 397, handicap: 5 },
        { par: 4, yardage: 342, handicap: 11 },
        { par: 3, yardage: 165, handicap: 15 },
        { par: 4, yardage: 431, handicap: 1 },
        { par: 3, yardage: 212, handicap: 9 },
        { par: 4, yardage: 368, handicap: 7 },
        { par: 5, yardage: 555, handicap: 3 },
        { par: 4, yardage: 305, handicap: 17 },
        { par: 4, yardage: 408, handicap: 13 },
        { par: 4, yardage: 362, handicap: 10 },
        { par: 4, yardage: 375, handicap: 4 },
        { par: 3, yardage: 148, handicap: 18 },
        { par: 4, yardage: 420, handicap: 2 },
        { par: 4, yardage: 370, handicap: 6 },
        { par: 5, yardage: 560, handicap: 8 },
        { par: 3, yardage: 130, handicap: 16 },
        { par: 4, yardage: 322, handicap: 14 },
        { par: 4, yardage: 380, handicap: 12 },
      ],
    },
  ],
  holes: [
    { par: 4, yardage: 427, handicap: 5 },
    { par: 4, yardage: 367, handicap: 11 },
    { par: 3, yardage: 185, handicap: 15 },
    { par: 4, yardage: 461, handicap: 1 },
    { par: 3, yardage: 232, handicap: 9 },
    { par: 4, yardage: 391, handicap: 7 },
    { par: 5, yardage: 585, handicap: 3 },
    { par: 4, yardage: 327, handicap: 17 },
    { par: 4, yardage: 432, handicap: 13 },
    { par: 4, yardage: 386, handicap: 10 },
    { par: 4, yardage: 399, handicap: 4 },
    { par: 3, yardage: 166, handicap: 18 },
    { par: 4, yardage: 448, handicap: 2 },
    { par: 4, yardage: 392, handicap: 6 },
    { par: 5, yardage: 591, handicap: 8 },
    { par: 3, yardage: 146, handicap: 16 },
    { par: 4, yardage: 344, handicap: 14 },
    { par: 4, yardage: 486, handicap: 12 },
  ],
}

// Hazard data matching the scorecard above — realistic per-hole hazards
export const SAMPLE_HAZARDS_BY_HOLE = [
  {
    hole: 1, holeName: 'The Opening', description: 'A demanding opening par 4 with fairway bunkers guarding both sides.',
    greenDepth: 30, visualNotes: 'FW narrows at 260; green angled back-left',
    distanceMarkers: [{ label: 'sprinkler to front', yards: 145 }],
    dogleg: 'straight',
    hazards: [
      { type: 'bunker', side: 'R', category: 'fairway', carry_yards: 255, distances_by_tee: { championship: 255, blue: 235 }, position_description: 'fairway bunker right side ~255 yards from championship tees', notes: 'fairway 250-270' },
      { type: 'bunker', side: 'L', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'greenside bunker short left of green', notes: 'greenside' },
    ],
    green_notes: 'Back-to-front slope, two tiers',
    recommended_line: 'Favor the left side off the tee to open up the green approach',
  },
  {
    hole: 2, holeName: null, description: 'Shorter par 4, dogleg left through a narrow corridor.',
    greenDepth: 28, visualNotes: 'Dogleg left at ~230; FW bunker guards inside corner',
    distanceMarkers: [],
    dogleg: 'left',
    hazards: [
      { type: 'bunker', side: 'L', category: 'fairway', carry_yards: 225, distances_by_tee: { championship: 225 }, position_description: 'fairway bunker left at the dogleg corner', notes: 'dogleg corner' },
      { type: 'trees', side: 'R', category: 'fairway', carry_yards: null, distances_by_tee: {}, position_description: 'tall pines lining the right side', notes: 'right side' },
    ],
    green_notes: 'Small, elevated green',
    recommended_line: 'Cut the corner with driver if you carry 230+',
  },
  {
    hole: 3, holeName: 'Short Iron', description: 'Scenic par 3 over a pond to a well-bunkered green.',
    greenDepth: 24, visualNotes: 'Water front; bunkers back-left and right',
    distanceMarkers: [{ label: 'front edge', yards: 172 }],
    dogleg: 'straight',
    hazards: [
      { type: 'water', side: 'front', category: 'greenside', carry_yards: 165, distances_by_tee: { championship: 165, blue: 145 }, position_description: 'pond fronting the green, carry 165 from tips', notes: 'fronting green' },
      { type: 'bunker', side: 'L', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'deep bunker back-left', notes: 'back-left' },
      { type: 'bunker', side: 'R', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'bunker right of green', notes: 'right' },
    ],
    green_notes: 'Shallow green, firm and fast',
    recommended_line: 'Club up — water front demands a full carry to the pin',
  },
  {
    hole: 4, holeName: 'The Monster', description: 'Long, demanding par 4 with trouble right.',
    greenDepth: 35, visualNotes: 'FW slopes left; deep bunker complex right at 280',
    distanceMarkers: [],
    dogleg: 'straight',
    hazards: [
      { type: 'bunker', side: 'R', category: 'fairway', carry_yards: 275, distances_by_tee: { championship: 275, blue: 250 }, position_description: 'large bunker complex right side 275y from championship', notes: 'right 270-290' },
      { type: 'OB', side: 'L', category: 'fairway', carry_yards: null, distances_by_tee: {}, position_description: 'OB stakes left along property line', notes: 'left side' },
    ],
    green_notes: 'Large green with severe back-right pin position',
    recommended_line: 'Left-center off the tee, keeping it right of the OB',
  },
  {
    hole: 5, holeName: 'The Ridge', description: 'Long par 3 to an elevated green.',
    greenDepth: 26, visualNotes: 'Green sits atop a ridge; fall-offs all around',
    distanceMarkers: [{ label: 'front edge', yards: 218 }],
    dogleg: 'straight',
    hazards: [
      { type: 'bunker', side: 'R', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'deep pot bunker right of green', notes: 'right' },
      { type: 'native', side: 'L', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'native area left and long', notes: 'left-long' },
    ],
    green_notes: 'Crowned green, putts break away from center',
    recommended_line: 'Aim center-left, the green feeds balls right',
  },
  {
    hole: 6, holeName: null, description: 'Medium par 4 with water crossing at 200 yards.',
    greenDepth: 29, visualNotes: 'Creek crosses FW at ~200; green slopes front-to-back',
    distanceMarkers: [{ label: 'creek crossing', yards: 198 }],
    dogleg: 'straight',
    hazards: [
      { type: 'creek', side: 'C', category: 'fairway', carry_yards: 200, distances_by_tee: { championship: 200, blue: 180 }, position_description: 'creek crosses the fairway at 200 yards', notes: 'crosses fairway' },
      { type: 'bunker', side: 'R', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'bunker guarding right side of green', notes: 'greenside right' },
    ],
    green_notes: 'Three-tier green',
    recommended_line: 'Lay up short of the creek or carry it with driver',
  },
  {
    hole: 7, holeName: 'The Reach', description: 'Reachable par 5 for long hitters, but treacherous short of the green.',
    greenDepth: 34, visualNotes: 'FW narrows at 290; creek before green; green kidney-shaped',
    distanceMarkers: [{ label: 'creek front of green', yards: 520 }],
    dogleg: 'right',
    hazards: [
      { type: 'bunker', side: 'L', category: 'fairway', carry_yards: 280, distances_by_tee: { championship: 280 }, position_description: 'fairway bunker left at 280 from tips', notes: 'left 275-290' },
      { type: 'creek', side: 'front', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'creek crossing in front of the green', notes: 'front of green' },
      { type: 'bunker', side: 'R', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'deep bunker right of green', notes: 'right greenside' },
    ],
    green_notes: 'Kidney-shaped, back-left pin protected by bunker',
    recommended_line: 'Right-center off the tee; lay up short of the creek unless going for it',
  },
  {
    hole: 8, holeName: 'Short Par 4', description: 'Drivable par 4 with severe penalty for missed green.',
    greenDepth: 25, visualNotes: 'Green small, angled left-to-right; waste area right',
    distanceMarkers: [],
    dogleg: 'straight',
    hazards: [
      { type: 'bunker', side: 'L', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'bunkers short left of green meant to trouble golfers who try to drive the green', notes: 'greenside left' },
      { type: 'native', side: 'R', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'sandy waste area right of green', notes: 'waste right' },
    ],
    green_notes: 'Small, sloped back-to-front',
    recommended_line: 'Can drive the green (327y) — favor left-center to avoid waste right',
  },
  {
    hole: 9, holeName: null, description: 'Strong par 4 finishing the front nine.',
    greenDepth: 31, visualNotes: 'FW bunkers both sides at 260; green well-protected',
    distanceMarkers: [],
    dogleg: 'straight',
    hazards: [
      { type: 'bunker', side: 'L', category: 'fairway', carry_yards: 258, distances_by_tee: { championship: 258 }, position_description: 'fairway bunker left at 258 from tips', notes: 'left 255-265' },
      { type: 'bunker', side: 'R', category: 'fairway', carry_yards: 265, distances_by_tee: { championship: 265 }, position_description: 'fairway bunker right at 265', notes: 'right 260-270' },
    ],
    green_notes: 'Flat green, subtle breaks',
    recommended_line: 'Split the fairway bunkers — wide landing area between them',
  },
  {
    hole: 10, holeName: null, description: 'Dogleg right par 4 to start the back nine.',
    greenDepth: 28, visualNotes: 'Dogleg right at ~240; water right of green',
    distanceMarkers: [],
    dogleg: 'right',
    hazards: [
      { type: 'water', side: 'R', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'pond right of green', notes: 'right of green' },
      { type: 'bunker', side: 'L', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'bunker left-front of green', notes: 'left-front' },
    ],
    green_notes: 'Slopes toward water right',
    recommended_line: 'Left-center off tee; approach from the left to hold the green',
  },
  {
    hole: 11, holeName: null, description: 'Medium par 4 with well-placed bunkers.',
    greenDepth: 27, visualNotes: 'FW bunker at 240 left; green pushed back-right',
    distanceMarkers: [],
    dogleg: 'straight',
    hazards: [
      { type: 'bunker', side: 'L', category: 'fairway', carry_yards: 240, distances_by_tee: { championship: 240, blue: 220 }, position_description: 'fairway bunker left at 240 from championship', notes: 'left 235-250' },
      { type: 'bunker', side: 'R', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'greenside bunker right', notes: 'greenside right' },
    ],
    green_notes: 'Moderate size, back-to-front slope',
    recommended_line: 'Right-center off tee to avoid the fairway bunker',
  },
  {
    hole: 12, holeName: 'The Gem', description: 'Short, beautiful par 3 over water.',
    greenDepth: 22, visualNotes: 'Water surrounds green on three sides; narrow bail-out right',
    distanceMarkers: [{ label: 'front edge', yards: 155 }],
    dogleg: 'straight',
    hazards: [
      { type: 'water', side: 'L', category: 'greenside', carry_yards: 150, distances_by_tee: { championship: 150, blue: 132 }, position_description: 'water left, front and back of green', notes: 'surrounds green' },
      { type: 'water', side: 'front', category: 'greenside', carry_yards: 148, distances_by_tee: {}, position_description: 'water fronting green', notes: 'front' },
    ],
    green_notes: 'Near-island green, slopes toward water',
    recommended_line: 'Club to the center of the green — do not short-side yourself',
  },
  {
    hole: 13, holeName: 'The Gauntlet', description: 'Long par 4 with hazards down the entire right side.',
    greenDepth: 33, visualNotes: 'OB right entire hole; creek at 300',
    distanceMarkers: [],
    dogleg: 'straight',
    hazards: [
      { type: 'OB', side: 'R', category: 'fairway', carry_yards: null, distances_by_tee: {}, position_description: 'OB right for the entire length of the hole', notes: 'right side full length' },
      { type: 'creek', side: 'C', category: 'fairway', carry_yards: 295, distances_by_tee: { championship: 295 }, position_description: 'creek crosses fairway at 295 from tips', notes: 'crosses at 295' },
    ],
    green_notes: 'Large green with false front',
    recommended_line: 'Left-center off the tee — stay well clear of OB right',
  },
  {
    hole: 14, holeName: null, description: 'Short dogleg left par 4.',
    greenDepth: 27, visualNotes: 'Dogleg left at 230; FW bunker right of corner',
    distanceMarkers: [],
    dogleg: 'left',
    hazards: [
      { type: 'bunker', side: 'R', category: 'fairway', carry_yards: 235, distances_by_tee: { championship: 235, blue: 215 }, position_description: 'fairway bunker right at the dogleg corner ~235y', notes: 'dogleg right side' },
      { type: 'trees', side: 'L', category: 'fairway', carry_yards: null, distances_by_tee: {}, position_description: 'mature oaks lining the left side through the dogleg', notes: 'left trees' },
    ],
    green_notes: 'Elevated green, back pin is tricky',
    recommended_line: 'Draw off the right bunker to shorten the hole',
  },
  {
    hole: 15, holeName: 'The Closer', description: 'Long par 5 with a creek splitting the fairway.',
    greenDepth: 36, visualNotes: 'Creek at 290 and again at 480; green on plateau',
    distanceMarkers: [{ label: 'first creek', yards: 288 }, { label: 'second creek', yards: 482 }],
    dogleg: 'straight',
    hazards: [
      { type: 'creek', side: 'C', category: 'fairway', carry_yards: 290, distances_by_tee: { championship: 290, blue: 265 }, position_description: 'creek crosses fairway at 290 from tips', notes: 'first crossing' },
      { type: 'creek', side: 'C', category: 'fairway', carry_yards: null, distances_by_tee: { championship: 480 }, position_description: 'second creek crossing at 480 before the green', notes: 'second crossing' },
      { type: 'bunker', side: 'L', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'deep greenside bunker left', notes: 'greenside left' },
    ],
    green_notes: 'Elevated plateau green, three tiers',
    recommended_line: 'Three-shot plan: lay up before each creek, wedge to the green',
  },
  {
    hole: 16, holeName: 'The Drop', description: 'Short par 3 dramatically downhill.',
    greenDepth: 23, visualNotes: 'Drop of ~40 feet; bunkers encircle green; wind exposed',
    distanceMarkers: [],
    dogleg: 'straight',
    hazards: [
      { type: 'bunker', side: 'L', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'bunker left of green', notes: 'left' },
      { type: 'bunker', side: 'R', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'bunker right of green', notes: 'right' },
      { type: 'bunker', side: 'front', category: 'greenside', carry_yards: 130, distances_by_tee: { championship: 130 }, position_description: 'front bunker guards the approach', notes: 'front' },
    ],
    green_notes: 'Small, crowned, wind-exposed',
    recommended_line: 'Take one less club — the 40-foot drop plays shorter',
  },
  {
    hole: 17, holeName: null, description: 'Short par 4 requiring precision.',
    greenDepth: 25, visualNotes: 'Narrow FW; green tucked behind bunkers',
    distanceMarkers: [],
    dogleg: 'straight',
    hazards: [
      { type: 'bunker', side: 'R', category: 'fairway', carry_yards: 230, distances_by_tee: { championship: 230 }, position_description: 'fairway bunker right at 230', notes: 'right 225-240' },
      { type: 'bunker', side: 'L', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'deep greenside bunker left', notes: 'greenside left' },
    ],
    green_notes: 'Undulating, multiple pin positions',
    recommended_line: 'Iron off the tee for position; wedge in',
  },
  {
    hole: 18, holeName: 'The Finish', description: 'Long, uphill par 4 to an amphitheater green.',
    greenDepth: 32, visualNotes: 'Uphill approach; bunkers front-left and right; amphitheater',
    distanceMarkers: [],
    dogleg: 'straight',
    hazards: [
      { type: 'bunker', side: 'L', category: 'fairway', carry_yards: 270, distances_by_tee: { championship: 270, blue: 248 }, position_description: 'fairway bunker left at 270 from championship tees', notes: 'left 265-280' },
      { type: 'bunker', side: 'L', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'greenside bunker front-left', notes: 'front-left' },
      { type: 'bunker', side: 'R', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'greenside bunker right', notes: 'right' },
    ],
    green_notes: 'Large amphitheater green, back-to-front slope',
    recommended_line: 'Right-center off the tee; extra club for the uphill approach',
  },
]

// Invalid hazard data for negative testing (implausible values)
export const IMPLAUSIBLE_HAZARDS = [
  {
    hole: 1,
    dogleg: 'straight',
    hazards: [
      // Hazard distance exceeds hole length (427y hole)
      { type: 'bunker', side: 'R', category: 'fairway', carry_yards: 500, notes: 'too far' },
      // Negative carry
      { type: 'water', side: 'L', category: 'fairway', carry_yards: -50, notes: 'negative' },
    ],
  },
  {
    hole: 3, // par 3, 185 yards
    dogleg: 'straight',
    hazards: [
      // Par 3 should not have fairway bunker at 250+ yards
      { type: 'bunker', side: 'R', category: 'fairway', carry_yards: 280, notes: 'too far for par 3' },
    ],
  },
  {
    hole: 5, // par 3, 232 yards
    dogleg: 'straight',
    hazards: [
      // Implausible water carry (> 300y)
      { type: 'water', side: 'front', category: 'greenside', carry_yards: 350, notes: 'implausible carry' },
    ],
  },
  {
    hole: 7,
    dogleg: 'right',
    hazards: [
      // Greenside hazard too far from green (585y hole, hazard at 200y = 385y from green)
      { type: 'bunker', side: 'R', category: 'greenside', carry_yards: 200, notes: 'too far for greenside' },
    ],
  },
  {
    hole: 8,
    dogleg: 'straight',
    hazards: [
      // Tee hazard too far (> 100y)
      { type: 'water', side: 'L', category: 'tee', carry_yards: 150, notes: 'tee hazard too far' },
    ],
  },
]

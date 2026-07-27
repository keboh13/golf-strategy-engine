// Fixture: Realistic LLM response for Ravines Golf Club scorecard extraction.
// Used by integration tests to verify the parsing pipeline end-to-end without
// hitting the real Claude API.

export const RAVINES_COURSE_NAME = 'Ravines Golf Club'
export const RAVINES_LOCATION = 'Saugatuck, MI'

// Simulated LLM response for scorecard extraction
export const RAVINES_LLM_SCORECARD_RESPONSE = `Here is the scorecard extracted from the PDF:

\`\`\`json
{
  "name": "Ravines Golf Club",
  "location": "Saugatuck, MI",
  "yardage": 6726,
  "rating": 72.1,
  "slope": 137,
  "par": 72,
  "selectedTee": "Blue",
  "_confidence": "high",
  "tees": [
    {
      "name": "Blue", "color": "blue", "yardage": 6726, "rating": 72.1, "slope": 137, "par": 72,
      "holes": [
        {"par":4,"yardage":387,"handicap":7},
        {"par":4,"yardage":415,"handicap":3},
        {"par":5,"yardage":542,"handicap":11},
        {"par":3,"yardage":178,"handicap":15},
        {"par":4,"yardage":410,"handicap":1},
        {"par":4,"yardage":358,"handicap":13},
        {"par":3,"yardage":195,"handicap":9},
        {"par":4,"yardage":368,"handicap":5},
        {"par":5,"yardage":515,"handicap":17},
        {"par":4,"yardage":392,"handicap":8},
        {"par":4,"yardage":435,"handicap":2},
        {"par":3,"yardage":162,"handicap":16},
        {"par":5,"yardage":530,"handicap":10},
        {"par":4,"yardage":378,"handicap":6},
        {"par":5,"yardage":505,"handicap":4},
        {"par":3,"yardage":188,"handicap":18},
        {"par":4,"yardage":372,"handicap":14},
        {"par":4,"yardage":396,"handicap":12}
      ]
    }
  ],
  "holes": [
    {"par":4,"yardage":387,"handicap":7},
    {"par":4,"yardage":415,"handicap":3},
    {"par":5,"yardage":542,"handicap":11},
    {"par":3,"yardage":178,"handicap":15},
    {"par":4,"yardage":410,"handicap":1},
    {"par":4,"yardage":358,"handicap":13},
    {"par":3,"yardage":195,"handicap":9},
    {"par":4,"yardage":368,"handicap":5},
    {"par":5,"yardage":515,"handicap":17},
    {"par":4,"yardage":392,"handicap":8},
    {"par":4,"yardage":435,"handicap":2},
    {"par":3,"yardage":162,"handicap":16},
    {"par":5,"yardage":530,"handicap":10},
    {"par":4,"yardage":378,"handicap":6},
    {"par":4,"yardage":405,"handicap":4},
    {"par":3,"yardage":188,"handicap":18},
    {"par":4,"yardage":372,"handicap":14},
    {"par":4,"yardage":396,"handicap":12}
  ]
}
\`\`\``

// Simulated LLM response for hazard extraction
export const RAVINES_LLM_HAZARD_RESPONSE = `Here are the hazards extracted from the yardage book:

\`\`\`json
{
  "hazardsByHole": [
    {
      "hole": 1, "dogleg": "straight",
      "hazards": [
        {"type":"bunker","side":"R","category":"fairway","carry_yards":250,"distances_by_tee":{"blue":250},"position_description":"fairway bunker right side at 250 from blue tees","notes":"right 245-260"},
        {"type":"bunker","side":"L","category":"greenside","carry_yards":null,"distances_by_tee":{},"position_description":"greenside bunker left of green","notes":"greenside left"}
      ],
      "green_notes": "Slight back-to-front slope", "recommended_line": "Left-center off the tee"
    },
    {
      "hole": 2, "dogleg": "left",
      "hazards": [
        {"type":"bunker","side":"L","category":"fairway","carry_yards":235,"distances_by_tee":{"blue":235},"position_description":"fairway bunker at the dogleg corner left side","notes":"dogleg corner"},
        {"type":"bunker","side":"R","category":"greenside","carry_yards":null,"distances_by_tee":{},"position_description":"greenside bunker right","notes":"greenside right"}
      ],
      "green_notes": "Elevated green, slopes front-to-back", "recommended_line": "Right-center to set up approach angle"
    },
    {
      "hole": 3, "dogleg": "straight",
      "hazards": [
        {"type":"bunker","side":"L","category":"fairway","carry_yards":265,"distances_by_tee":{"blue":265},"position_description":"fairway bunker left at 265","notes":"left 260-275"},
        {"type":"creek","side":"C","category":"fairway","carry_yards":290,"distances_by_tee":{"blue":290},"position_description":"creek crosses fairway at 290 from blue tees","notes":"crosses fairway"},
        {"type":"bunker","side":"R","category":"greenside","carry_yards":null,"distances_by_tee":{},"position_description":"bunker right of green","notes":"greenside right"}
      ],
      "green_notes": "Large green, three tiers", "recommended_line": "Favor the right side for two-putt birdie chance"
    },
    {
      "hole": 4, "dogleg": "straight",
      "hazards": [
        {"type":"water","side":"front","category":"greenside","carry_yards":165,"distances_by_tee":{"blue":165},"position_description":"pond fronting the green","notes":"fronting green"},
        {"type":"bunker","side":"R","category":"greenside","carry_yards":null,"distances_by_tee":{},"position_description":"bunker right of green","notes":"right"}
      ],
      "green_notes": "Shallow green protected by water", "recommended_line": "Take enough club to carry the water"
    },
    {
      "hole": 5, "dogleg": "right",
      "hazards": [
        {"type":"water","side":"R","category":"fairway","carry_yards":240,"distances_by_tee":{"blue":240},"position_description":"lake runs along the right side from 240 to the green","notes":"right side 240-410"},
        {"type":"bunker","side":"L","category":"fairway","carry_yards":255,"distances_by_tee":{"blue":255},"position_description":"fairway bunker left at 255","notes":"left 250-265"},
        {"type":"water","side":"R","category":"greenside","carry_yards":null,"distances_by_tee":{},"position_description":"lake continues right of green","notes":"right of green"}
      ],
      "green_notes": "Green slopes toward water right", "recommended_line": "Aim left-center, avoid the water right at all costs"
    },
    {
      "hole": 6, "dogleg": "straight",
      "hazards": [
        {"type":"bunker","side":"L","category":"fairway","carry_yards":230,"distances_by_tee":{"blue":230},"position_description":"fairway bunker left at 230","notes":"left 225-240"},
        {"type":"bunker","side":"R","category":"greenside","carry_yards":null,"distances_by_tee":{},"position_description":"greenside bunker right","notes":"greenside right"}
      ],
      "green_notes": "Moderate slope, back pin tricky", "recommended_line": "Favor right side off tee"
    },
    {
      "hole": 7, "dogleg": "straight",
      "hazards": [
        {"type":"bunker","side":"R","category":"greenside","carry_yards":null,"distances_by_tee":{},"position_description":"deep bunker right of green","notes":"right"},
        {"type":"bunker","side":"L","category":"greenside","carry_yards":null,"distances_by_tee":{},"position_description":"bunker front-left","notes":"front-left"}
      ],
      "green_notes": "Well-bunkered green", "recommended_line": "Center of the green is always safe"
    },
    {
      "hole": 8, "dogleg": "left",
      "hazards": [
        {"type":"trees","side":"L","category":"fairway","carry_yards":null,"distances_by_tee":{},"position_description":"tall pines lining left side through dogleg","notes":"left side"},
        {"type":"bunker","side":"R","category":"fairway","carry_yards":245,"distances_by_tee":{"blue":245},"position_description":"fairway bunker right at 245","notes":"right 240-255"},
        {"type":"bunker","side":"L","category":"greenside","carry_yards":null,"distances_by_tee":{},"position_description":"greenside bunker left","notes":"greenside left"}
      ],
      "green_notes": "Angled green, opens from the right", "recommended_line": "Right-center off tee for best approach angle"
    },
    {
      "hole": 9, "dogleg": "straight",
      "hazards": [
        {"type":"water","side":"L","category":"fairway","carry_yards":220,"distances_by_tee":{"blue":220},"position_description":"creek runs along left side from 220 to 320","notes":"left side 220-320"},
        {"type":"bunker","side":"R","category":"fairway","carry_yards":260,"distances_by_tee":{"blue":260},"position_description":"fairway bunker right at 260","notes":"right 255-270"},
        {"type":"bunker","side":"L","category":"greenside","carry_yards":null,"distances_by_tee":{},"position_description":"greenside bunker left","notes":"greenside left"}
      ],
      "green_notes": "Back-to-front slope, fast downhill putts", "recommended_line": "Right-center, lay up short of the bunker if needed"
    },
    {
      "hole": 10, "dogleg": "right",
      "hazards": [
        {"type":"bunker","side":"R","category":"fairway","carry_yards":255,"distances_by_tee":{"blue":255},"position_description":"fairway bunker right at the corner","notes":"dogleg corner"},
        {"type":"bunker","side":"L","category":"greenside","carry_yards":null,"distances_by_tee":{},"position_description":"greenside bunker left","notes":"greenside left"}
      ],
      "green_notes": "Two tiers, front pin plays longer", "recommended_line": "Favor the left side off tee"
    },
    {
      "hole": 11, "dogleg": "straight",
      "hazards": [
        {"type":"water","side":"R","category":"fairway","carry_yards":235,"distances_by_tee":{"blue":235},"position_description":"ravine with creek right side from 235 to green","notes":"ravine right 235-435"},
        {"type":"bunker","side":"L","category":"fairway","carry_yards":260,"distances_by_tee":{"blue":260},"position_description":"fairway bunker left at 260","notes":"left 255-270"},
        {"type":"bunker","side":"R","category":"greenside","carry_yards":null,"distances_by_tee":{},"position_description":"bunker front-right of green","notes":"front-right"}
      ],
      "green_notes": "Green slopes toward the ravine", "recommended_line": "Left-center is the safe play, favor the bunker over the ravine"
    },
    {
      "hole": 12, "dogleg": "straight",
      "hazards": [
        {"type":"bunker","side":"L","category":"greenside","carry_yards":null,"distances_by_tee":{},"position_description":"bunker left of green","notes":"left"},
        {"type":"bunker","side":"R","category":"greenside","carry_yards":null,"distances_by_tee":{},"position_description":"bunker right of green","notes":"right"}
      ],
      "green_notes": "Small target, heavily bunkered", "recommended_line": "Middle of the green, two-putt par"
    },
    {
      "hole": 13, "dogleg": "left",
      "hazards": [
        {"type":"water","side":"L","category":"fairway","carry_yards":250,"distances_by_tee":{"blue":250},"position_description":"lake left from 250 through the green","notes":"left side 250+"},
        {"type":"bunker","side":"R","category":"fairway","carry_yards":270,"distances_by_tee":{"blue":270},"position_description":"fairway bunker right at 270","notes":"right 265-280"},
        {"type":"bunker","side":"L","category":"greenside","carry_yards":null,"distances_by_tee":{},"position_description":"greenside bunker front-left between water and green","notes":"front-left"}
      ],
      "green_notes": "Green angles toward lake left", "recommended_line": "Right-center off tee, approach from the right"
    },
    {
      "hole": 14, "dogleg": "straight",
      "hazards": [
        {"type":"bunker","side":"L","category":"fairway","carry_yards":240,"distances_by_tee":{"blue":240},"position_description":"fairway bunker left at 240","notes":"left 235-250"},
        {"type":"bunker","side":"R","category":"greenside","carry_yards":null,"distances_by_tee":{},"position_description":"bunker right of green","notes":"greenside right"}
      ],
      "green_notes": "Undulating putting surface", "recommended_line": "Right side off tee, avoid the bunker left"
    },
    {
      "hole": 15, "dogleg": "straight",
      "hazards": [
        {"type":"bunker","side":"R","category":"fairway","carry_yards":250,"distances_by_tee":{"blue":250},"position_description":"fairway bunker right at 250","notes":"right 245-260"},
        {"type":"water","side":"L","category":"greenside","carry_yards":null,"distances_by_tee":{},"position_description":"pond left of green","notes":"left of green"},
        {"type":"bunker","side":"R","category":"greenside","carry_yards":null,"distances_by_tee":{},"position_description":"bunker right of green","notes":"greenside right"}
      ],
      "green_notes": "Green slopes toward water left", "recommended_line": "Aim right-center approach to avoid water left"
    },
    {
      "hole": 16, "dogleg": "straight",
      "hazards": [
        {"type":"bunker","side":"front","category":"greenside","carry_yards":175,"distances_by_tee":{"blue":175},"position_description":"bunker fronting the green","notes":"front"},
        {"type":"bunker","side":"back","category":"greenside","carry_yards":null,"distances_by_tee":{},"position_description":"bunker behind green","notes":"back"}
      ],
      "green_notes": "Crowned green, putts break away", "recommended_line": "Carry the front bunker, don't go long"
    },
    {
      "hole": 17, "dogleg": "left",
      "hazards": [
        {"type":"trees","side":"L","category":"fairway","carry_yards":null,"distances_by_tee":{},"position_description":"trees lining left through dogleg","notes":"left side"},
        {"type":"bunker","side":"R","category":"fairway","carry_yards":235,"distances_by_tee":{"blue":235},"position_description":"fairway bunker right at 235","notes":"right 230-245"},
        {"type":"bunker","side":"L","category":"greenside","carry_yards":null,"distances_by_tee":{},"position_description":"greenside bunker left","notes":"greenside left"}
      ],
      "green_notes": "Narrow green, front-to-back slope", "recommended_line": "Draw around the corner, keep it short of the bunker"
    },
    {
      "hole": 18, "dogleg": "straight",
      "hazards": [
        {"type":"water","side":"C","category":"fairway","carry_yards":290,"distances_by_tee":{"blue":290},"position_description":"pond crossing the fairway on approach","notes":"crosses fairway at 290"},
        {"type":"bunker","side":"L","category":"greenside","carry_yards":null,"distances_by_tee":{},"position_description":"bunker left of green","notes":"left"},
        {"type":"bunker","side":"R","category":"greenside","carry_yards":null,"distances_by_tee":{},"position_description":"bunker right of green","notes":"right"}
      ],
      "green_notes": "Amphitheater green, dramatic finish", "recommended_line": "Aim center, carry the water with confidence"
    }
  ]
}
\`\`\``

// Parsed scorecard (what parseJsonFromText returns from the LLM response)
export const RAVINES_PARSED_SCORECARD = {
  name: 'Ravines Golf Club',
  location: 'Saugatuck, MI',
  yardage: 6726,
  rating: 72.1,
  slope: 137,
  par: 72,
  selectedTee: 'Blue',
  _confidence: 'high',
  tees: [
    {
      name: 'Blue', color: 'blue', yardage: 6726, rating: 72.1, slope: 137, par: 72,
      holes: [
        { par: 4, yardage: 387, handicap: 7 },
        { par: 4, yardage: 415, handicap: 3 },
        { par: 5, yardage: 542, handicap: 11 },
        { par: 3, yardage: 178, handicap: 15 },
        { par: 4, yardage: 410, handicap: 1 },
        { par: 4, yardage: 358, handicap: 13 },
        { par: 3, yardage: 195, handicap: 9 },
        { par: 4, yardage: 368, handicap: 5 },
        { par: 5, yardage: 515, handicap: 17 },
        { par: 4, yardage: 392, handicap: 8 },
        { par: 4, yardage: 435, handicap: 2 },
        { par: 3, yardage: 162, handicap: 16 },
        { par: 5, yardage: 530, handicap: 10 },
        { par: 4, yardage: 378, handicap: 6 },
        { par: 5, yardage: 505, handicap: 4 },
        { par: 3, yardage: 188, handicap: 18 },
        { par: 4, yardage: 372, handicap: 14 },
        { par: 4, yardage: 396, handicap: 12 },
      ],
    },
  ],
  holes: [
    { par: 4, yardage: 387, handicap: 7 },
    { par: 4, yardage: 415, handicap: 3 },
    { par: 5, yardage: 542, handicap: 11 },
    { par: 3, yardage: 178, handicap: 15 },
    { par: 4, yardage: 410, handicap: 1 },
    { par: 4, yardage: 358, handicap: 13 },
    { par: 3, yardage: 195, handicap: 9 },
    { par: 4, yardage: 368, handicap: 5 },
    { par: 5, yardage: 515, handicap: 17 },
    { par: 4, yardage: 392, handicap: 8 },
    { par: 4, yardage: 435, handicap: 2 },
    { par: 3, yardage: 162, handicap: 16 },
    { par: 5, yardage: 530, handicap: 10 },
    { par: 4, yardage: 378, handicap: 6 },
    { par: 5, yardage: 505, handicap: 4 },
    { par: 3, yardage: 188, handicap: 18 },
    { par: 4, yardage: 372, handicap: 14 },
    { par: 4, yardage: 396, handicap: 12 },
  ],
}

// Parsed hazards (what parseJsonFromText returns from the hazard LLM response)
export const RAVINES_PARSED_HAZARDS = [
  {
    hole: 1, dogleg: 'straight',
    hazards: [
      { type: 'bunker', side: 'R', category: 'fairway', carry_yards: 250, distances_by_tee: { blue: 250 }, position_description: 'fairway bunker right side at 250 from blue tees', notes: 'right 245-260' },
      { type: 'bunker', side: 'L', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'greenside bunker left of green', notes: 'greenside left' },
    ],
    green_notes: 'Slight back-to-front slope',
  },
  {
    hole: 2, dogleg: 'left',
    hazards: [
      { type: 'bunker', side: 'L', category: 'fairway', carry_yards: 235, distances_by_tee: { blue: 235 }, position_description: 'fairway bunker at the dogleg corner left side', notes: 'dogleg corner' },
      { type: 'bunker', side: 'R', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'greenside bunker right', notes: 'greenside right' },
    ],
    green_notes: 'Elevated green, slopes front-to-back',
  },
  {
    hole: 3, dogleg: 'straight',
    hazards: [
      { type: 'bunker', side: 'L', category: 'fairway', carry_yards: 265, distances_by_tee: { blue: 265 }, position_description: 'fairway bunker left at 265', notes: 'left 260-275' },
      { type: 'creek', side: 'C', category: 'fairway', carry_yards: 290, distances_by_tee: { blue: 290 }, position_description: 'creek crosses fairway at 290 from blue tees', notes: 'crosses fairway' },
      { type: 'bunker', side: 'R', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'bunker right of green', notes: 'greenside right' },
    ],
    green_notes: 'Large green, three tiers',
  },
  {
    hole: 4, dogleg: 'straight',
    hazards: [
      { type: 'water', side: 'front', category: 'greenside', carry_yards: 165, distances_by_tee: { blue: 165 }, position_description: 'pond fronting the green', notes: 'fronting green' },
      { type: 'bunker', side: 'R', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'bunker right of green', notes: 'right' },
    ],
    green_notes: 'Shallow green protected by water',
  },
  {
    hole: 5, dogleg: 'right',
    hazards: [
      { type: 'water', side: 'R', category: 'fairway', carry_yards: 240, distances_by_tee: { blue: 240 }, position_description: 'lake runs along the right side from 240 to the green', notes: 'right side 240-410' },
      { type: 'bunker', side: 'L', category: 'fairway', carry_yards: 255, distances_by_tee: { blue: 255 }, position_description: 'fairway bunker left at 255', notes: 'left 250-265' },
      { type: 'water', side: 'R', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'lake continues right of green', notes: 'right of green' },
    ],
    green_notes: 'Green slopes toward water right',
  },
  {
    hole: 6, dogleg: 'straight',
    hazards: [
      { type: 'bunker', side: 'L', category: 'fairway', carry_yards: 230, distances_by_tee: { blue: 230 }, position_description: 'fairway bunker left at 230', notes: 'left 225-240' },
      { type: 'bunker', side: 'R', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'greenside bunker right', notes: 'greenside right' },
    ],
    green_notes: 'Moderate slope, back pin tricky',
  },
  {
    hole: 7, dogleg: 'straight',
    hazards: [
      { type: 'bunker', side: 'R', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'deep bunker right of green', notes: 'right' },
      { type: 'bunker', side: 'L', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'bunker front-left', notes: 'front-left' },
    ],
    green_notes: 'Well-bunkered green',
  },
  {
    hole: 8, dogleg: 'left',
    hazards: [
      { type: 'trees', side: 'L', category: 'fairway', carry_yards: null, distances_by_tee: {}, position_description: 'tall pines lining left side through dogleg', notes: 'left side' },
      { type: 'bunker', side: 'R', category: 'fairway', carry_yards: 245, distances_by_tee: { blue: 245 }, position_description: 'fairway bunker right at 245', notes: 'right 240-255' },
      { type: 'bunker', side: 'L', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'greenside bunker left', notes: 'greenside left' },
    ],
    green_notes: 'Angled green, opens from the right',
  },
  {
    hole: 9, dogleg: 'straight',
    hazards: [
      { type: 'water', side: 'L', category: 'fairway', carry_yards: 220, distances_by_tee: { blue: 220 }, position_description: 'creek runs along left side from 220 to 320', notes: 'left side 220-320' },
      { type: 'bunker', side: 'R', category: 'fairway', carry_yards: 260, distances_by_tee: { blue: 260 }, position_description: 'fairway bunker right at 260', notes: 'right 255-270' },
      { type: 'bunker', side: 'L', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'greenside bunker left', notes: 'greenside left' },
    ],
    green_notes: 'Back-to-front slope, fast downhill putts',
  },
  {
    hole: 10, dogleg: 'right',
    hazards: [
      { type: 'bunker', side: 'R', category: 'fairway', carry_yards: 255, distances_by_tee: { blue: 255 }, position_description: 'fairway bunker right at the corner', notes: 'dogleg corner' },
      { type: 'bunker', side: 'L', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'greenside bunker left', notes: 'greenside left' },
    ],
    green_notes: 'Two tiers, front pin plays longer',
  },
  {
    hole: 11, dogleg: 'straight',
    hazards: [
      { type: 'water', side: 'R', category: 'fairway', carry_yards: 235, distances_by_tee: { blue: 235 }, position_description: 'ravine with creek right side from 235 to green', notes: 'ravine right 235-435' },
      { type: 'bunker', side: 'L', category: 'fairway', carry_yards: 260, distances_by_tee: { blue: 260 }, position_description: 'fairway bunker left at 260', notes: 'left 255-270' },
      { type: 'bunker', side: 'R', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'bunker front-right of green', notes: 'front-right' },
    ],
    green_notes: 'Green slopes toward the ravine',
  },
  {
    hole: 12, dogleg: 'straight',
    hazards: [
      { type: 'bunker', side: 'L', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'bunker left of green', notes: 'left' },
      { type: 'bunker', side: 'R', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'bunker right of green', notes: 'right' },
    ],
    green_notes: 'Small target, heavily bunkered',
  },
  {
    hole: 13, dogleg: 'left',
    hazards: [
      { type: 'water', side: 'L', category: 'fairway', carry_yards: 250, distances_by_tee: { blue: 250 }, position_description: 'lake left from 250 through the green', notes: 'left side 250+' },
      { type: 'bunker', side: 'R', category: 'fairway', carry_yards: 270, distances_by_tee: { blue: 270 }, position_description: 'fairway bunker right at 270', notes: 'right 265-280' },
      { type: 'bunker', side: 'L', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'greenside bunker front-left between water and green', notes: 'front-left' },
    ],
    green_notes: 'Green angles toward lake left',
  },
  {
    hole: 14, dogleg: 'straight',
    hazards: [
      { type: 'bunker', side: 'L', category: 'fairway', carry_yards: 240, distances_by_tee: { blue: 240 }, position_description: 'fairway bunker left at 240', notes: 'left 235-250' },
      { type: 'bunker', side: 'R', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'bunker right of green', notes: 'greenside right' },
    ],
    green_notes: 'Undulating putting surface',
  },
  {
    hole: 15, dogleg: 'straight',
    hazards: [
      { type: 'bunker', side: 'R', category: 'fairway', carry_yards: 250, distances_by_tee: { blue: 250 }, position_description: 'fairway bunker right at 250', notes: 'right 245-260' },
      { type: 'water', side: 'L', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'pond left of green', notes: 'left of green' },
      { type: 'bunker', side: 'R', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'bunker right of green', notes: 'greenside right' },
    ],
    green_notes: 'Green slopes toward water left',
  },
  {
    hole: 16, dogleg: 'straight',
    hazards: [
      { type: 'bunker', side: 'front', category: 'greenside', carry_yards: 175, distances_by_tee: { blue: 175 }, position_description: 'bunker fronting the green', notes: 'front' },
      { type: 'bunker', side: 'back', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'bunker behind green', notes: 'back' },
    ],
    green_notes: 'Crowned green, putts break away',
  },
  {
    hole: 17, dogleg: 'left',
    hazards: [
      { type: 'trees', side: 'L', category: 'fairway', carry_yards: null, distances_by_tee: {}, position_description: 'trees lining left through dogleg', notes: 'left side' },
      { type: 'bunker', side: 'R', category: 'fairway', carry_yards: 235, distances_by_tee: { blue: 235 }, position_description: 'fairway bunker right at 235', notes: 'right 230-245' },
      { type: 'bunker', side: 'L', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'greenside bunker left', notes: 'greenside left' },
    ],
    green_notes: 'Narrow green, front-to-back slope',
  },
  {
    hole: 18, dogleg: 'straight',
    hazards: [
      { type: 'water', side: 'C', category: 'fairway', carry_yards: 290, distances_by_tee: { blue: 290 }, position_description: 'pond crossing the fairway on approach', notes: 'crosses fairway at 290' },
      { type: 'bunker', side: 'L', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'bunker left of green', notes: 'left' },
      { type: 'bunker', side: 'R', category: 'greenside', carry_yards: null, distances_by_tee: {}, position_description: 'bunker right of green', notes: 'right' },
    ],
    green_notes: 'Amphitheater green, dramatic finish',
  },
]

// Malformed LLM response for negative testing
export const RAVINES_MALFORMED_LLM_RESPONSE = `I found some data but it seems incomplete:

{
  "hazardsByHole": "not_an_array",
  "name": 123
}`

// Truncated LLM response (simulating a response that gets cut off)
export const RAVINES_TRUNCATED_LLM_RESPONSE = `Here is the scorecard:

{
  "name": "Ravines Golf Club",
  "holes": [
    {"par":4,"yardage":387,"handicap":7},
    {"par":4,"yardage":415,"handicap":3}
  ]
}`

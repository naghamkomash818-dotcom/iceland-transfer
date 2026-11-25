/**
 * ICELAND TRANSFER — Booking API
 * Version 2.2.1
 * Node.js 18+ / CommonJS
 *
 * Required:
 * SUPABASE_URL
 * SUPABASE_SECRET_KEY
 *
 * Optional:
 * GOOGLE_MAPS_API_KEY
 * SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM
 * EUR_TO_ISK_RATE
 * PUBLIC_SERVER_URL
 *
 * Teya payments are deliberately disabled.
 */

require("dotenv").config();

const http = require("http");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

let nodemailer = null;

try {
  nodemailer = require("nodemailer");
} catch (_) {}

const PORT = Number(process.env.PORT || 3000);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const PUBLIC_SERVER_URL = (
  process.env.PUBLIC_SERVER_URL ||
  "https://iceland-transfer-server.onrender.com"
).replace(/\/$/, "");

const GOOGLE_MAPS_API_KEY =
  process.env.GOOGLE_MAPS_API_KEY || "";

const EUR_TO_ISK_RATE = Number(
  process.env.EUR_TO_ISK_RATE || 137.20
);

const MAX_BODY_BYTES = 1024 * 1024;

const TIME_ZONE = "Atlantic/Reykjavik";
const OPENING_HOUR = 0;
const CLOSING_HOUR = 24;

const MAX_BOOKINGS_PER_HOUR = 5;
const CANCELLATION_HOURS = 24;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SECRET_KEY."
  );
  process.exit(1);
}

if (
  !Number.isFinite(EUR_TO_ISK_RATE) ||
  EUR_TO_ISK_RATE <= 0
) {
  console.error("Invalid EUR_TO_ISK_RATE.");
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

// ==========================================
// VEHICLES
// ==========================================

const VEHICLES = [
  {
    code: "standard",
    name: "Private Standard",
    minPassengers: 1,
    maxPassengers: 3,
    largeBags: 2,
    handBags: 0,
    fromEur: 110
  },
  {
    code: "comfort",
    name: "Private Comfort",
    minPassengers: 1,
    maxPassengers: 4,
    largeBags: 2,
    handBags: 2,
    fromEur: 136
  },
  {
    code: "suv",
    name: "Private SUV",
    minPassengers: 1,
    maxPassengers: 4,
    largeBags: 4,
    handBags: 2,
    fromEur: 150
  },
  {
    code: "van",
    name: "Private Van",
    minPassengers: 1,
    maxPassengers: 8,
    largeBags: 10,
    handBags: 8,
    fromEur: 191
  }
];

// ==========================================
// ROUTES
// ==========================================

const ROUTES = [
  {
    code: "keflavik-airport-blue-lagoon",
    origin: "Keflavík Airport",
    destination: "Blue Lagoon",
    name: "Keflavík Airport → Blue Lagoon",
    aliases: ["Blue Lagoon"],
    distanceKm: 22,
    estimatedMinutes: 19,
    prices: {"comfort": 90, "suv": 105, "van": 115}
  },
  {
    code: "reykjavik-keflavik-airport",
    origin: "Reykjavík",
    originAliases: ["Reykjavik", "Reykjavík city centre", "Reykjavik city center"],
    destination: "Keflavík Airport",
    name: "Reykjavík → Keflavík Airport",
    aliases: ["Keflavik Airport", "Keflavík International Airport", "Keflavik International Airport", "KEF", "KEF Airport"],
    distanceKm: 51,
    estimatedMinutes: 47,
    prices: {"standard": 110, "comfort": 136, "suv": 150, "van": 191}
  },
  {
    code: "blue-lagoon-reykjavik",
    origin: "Blue Lagoon",
    originAliases: ["Blue Lagoon"],
    destination: "Reykjavík",
    name: "Blue Lagoon → Reykjavík",
    aliases: ["Reykjavik"],
    distanceKm: 49,
    estimatedMinutes: 44,
    prices: {"standard": 110, "comfort": 136, "suv": 150, "van": 191}
  },
  {
    code: "keflavik-airport-hafnarfjorur",
    origin: "Keflavík Airport",
    destination: "Hafnarfjörður",
    name: "Keflavík Airport → Hafnarfjörður",
    aliases: ["Hafnarfjordur"],
    distanceKm: 39,
    estimatedMinutes: 31,
    prices: {"standard": 110, "comfort": 136, "suv": 150, "van": 191}
  },
  {
    code: "keflavik-airport-garabr",
    origin: "Keflavík Airport",
    destination: "Garðabær",
    name: "Keflavík Airport → Garðabær",
    aliases: ["Gardabaer"],
    distanceKm: 42,
    estimatedMinutes: 35,
    prices: {"standard": 110, "comfort": 136, "suv": 150, "van": 191}
  },
  {
    code: "keflavik-airport-sky-lagoon",
    origin: "Keflavík Airport",
    destination: "Sky Lagoon",
    name: "Keflavík Airport → Sky Lagoon",
    aliases: [],
    distanceKm: 48,
    estimatedMinutes: 43,
    prices: {"standard": 110, "comfort": 136, "suv": 150, "van": 191}
  },
  {
    code: "keflavik-airport-reykjavik",
    origin: "Keflavík Airport",
    destination: "Reykjavík",
    name: "Keflavík Airport → Reykjavík",
    aliases: ["Reykjavik", "Reykjavík Downtown"],
    distanceKm: 51,
    estimatedMinutes: 47,
    prices: {"standard": 110, "comfort": 136, "suv": 150, "van": 191}
  },
  {
    code: "keflavik-airport-skarfabakki-harbour",
    origin: "Keflavík Airport",
    destination: "Skarfabakki Harbour",
    name: "Keflavík Airport → Skarfabakki Harbour",
    aliases: ["Skarfabakki", "Cruise Port"],
    distanceKm: 53,
    estimatedMinutes: 46,
    prices: {"standard": 110, "comfort": 136, "suv": 150, "van": 191}
  },
  {
    code: "keflavik-airport-mosfellsbr",
    origin: "Keflavík Airport",
    destination: "Mosfellsbær",
    name: "Keflavík Airport → Mosfellsbær",
    aliases: ["Mosfellsbaer"],
    distanceKm: 59,
    estimatedMinutes: 49,
    prices: {"comfort": 147, "suv": 162, "van": 206}
  },
  {
    code: "keflavik-airport-ingvellir",
    origin: "Keflavík Airport",
    destination: "Þingvellir",
    name: "Keflavík Airport → Þingvellir",
    aliases: ["Thingvellir", "Thingvellir National Park"],
    distanceKm: 86,
    estimatedMinutes: 70,
    prices: {"comfort": 219, "suv": 243, "van": 305}
  },
  {
    code: "keflavik-airport-hverageri",
    origin: "Keflavík Airport",
    destination: "Hveragerði",
    name: "Keflavík Airport → Hveragerði",
    aliases: ["Hveragerdi"],
    distanceKm: 86,
    estimatedMinutes: 68,
    prices: {"comfort": 219, "suv": 243, "van": 305}
  },
  {
    code: "keflavik-airport-akranes",
    origin: "Keflavík Airport",
    destination: "Akranes",
    name: "Keflavík Airport → Akranes",
    aliases: [],
    distanceKm: 91,
    estimatedMinutes: 74,
    prices: {"comfort": 232, "suv": 258, "van": 323}
  },
  {
    code: "keflavik-airport-hvammsvik",
    origin: "Keflavík Airport",
    destination: "Hvammsvík",
    name: "Keflavík Airport → Hvammsvík",
    aliases: ["Hvammsvik"],
    distanceKm: 96,
    estimatedMinutes: 77,
    prices: {"comfort": 245, "suv": 273, "van": 341}
  },
  {
    code: "keflavik-airport-selfoss",
    origin: "Keflavík Airport",
    destination: "Selfoss",
    name: "Keflavík Airport → Selfoss",
    aliases: [],
    distanceKm: 96,
    estimatedMinutes: 60,
    prices: {"comfort": 245, "suv": 273, "van": 341}
  },
  {
    code: "keflavik-airport-glymur-waterfall",
    origin: "Keflavík Airport",
    destination: "Glymur Waterfall",
    name: "Keflavík Airport → Glymur Waterfall",
    aliases: ["Glymur"],
    distanceKm: 113,
    estimatedMinutes: 94,
    prices: {"comfort": 290, "suv": 324, "van": 403}
  },
  {
    code: "keflavik-airport-borgarnes",
    origin: "Keflavík Airport",
    destination: "Borgarnes",
    name: "Keflavík Airport → Borgarnes",
    aliases: [],
    distanceKm: 117,
    estimatedMinutes: 91,
    prices: {"comfort": 301, "suv": 336, "van": 418}
  },
  {
    code: "keflavik-airport-hella",
    origin: "Keflavík Airport",
    destination: "Hella",
    name: "Keflavík Airport → Hella",
    aliases: [],
    distanceKm: 134,
    estimatedMinutes: 107,
    prices: {"comfort": 346, "suv": 387, "van": 480}
  },
  {
    code: "keflavik-airport-fluir",
    origin: "Keflavík Airport",
    destination: "Flúðir",
    name: "Keflavík Airport → Flúðir",
    aliases: ["Fludir"],
    distanceKm: 143,
    estimatedMinutes: 113,
    prices: {"comfort": 370, "suv": 414, "van": 513}
  },
  {
    code: "keflavik-airport-secret-lagoon",
    origin: "Keflavík Airport",
    destination: "Secret Lagoon",
    name: "Keflavík Airport → Secret Lagoon",
    aliases: ["Gamla Laugin"],
    distanceKm: 144,
    estimatedMinutes: 115,
    prices: {"comfort": 372, "suv": 417, "van": 516}
  },
  {
    code: "keflavik-airport-reykholt",
    origin: "Keflavík Airport",
    destination: "Reykholt",
    name: "Keflavík Airport → Reykholt",
    aliases: [],
    distanceKm: 151,
    estimatedMinutes: 118,
    prices: {"comfort": 391, "suv": 438, "van": 542}
  },
  {
    code: "keflavik-airport-gullfoss",
    origin: "Keflavík Airport",
    destination: "Gullfoss",
    name: "Keflavík Airport → Gullfoss",
    aliases: ["Gullfoss Waterfall"],
    distanceKm: 158,
    estimatedMinutes: 133,
    prices: {"comfort": 409, "suv": 459, "van": 567}
  },
  {
    code: "keflavik-airport-husafell",
    origin: "Keflavík Airport",
    destination: "Húsafell",
    name: "Keflavík Airport → Húsafell",
    aliases: ["Husafell"],
    distanceKm: 174,
    estimatedMinutes: 134,
    prices: {"comfort": 452, "suv": 507, "van": 626}
  },
  {
    code: "keflavik-airport-landeyjahofn",
    origin: "Keflavík Airport",
    destination: "Landeyjahöfn",
    name: "Keflavík Airport → Landeyjahöfn",
    aliases: ["Landeyjahofn"],
    distanceKm: 177,
    estimatedMinutes: 140,
    prices: {"comfort": 460, "suv": 516, "van": 637}
  },
  {
    code: "keflavik-airport-grundarfjorur",
    origin: "Keflavík Airport",
    destination: "Grundarfjörður",
    name: "Keflavík Airport → Grundarfjörður",
    aliases: ["Grundarfjordur"],
    distanceKm: 219,
    estimatedMinutes: 168,
    prices: {"comfort": 571, "suv": 642, "van": 790}
  },
  {
    code: "keflavik-airport-landmannalaugar",
    origin: "Keflavík Airport",
    destination: "Landmannalaugar",
    aliases: [],
    distanceKm: 220,
    estimatedMinutes: 215,
    prices: {"comfort": 574, "suv": 645, "van": 794}
  },
  {
    code: "keflavik-airport-reynisfjara-beach",
    origin: "Keflavík Airport",
    destination: "Reynisfjara Beach",
    name: "Keflavík Airport → Reynisfjara Beach",
    aliases: ["Reynisfjara"],
    distanceKm: 227,
    estimatedMinutes: 176,
    prices: {"comfort": 592, "suv": 666, "van": 819}
  },
  {
    code: "keflavik-airport-vik-i-myrdal",
    origin: "Keflavík Airport",
    destination: "Vík í Mýrdal",
    name: "Keflavík Airport → Vík í Mýrdal",
    aliases: ["Vik", "Vik i Myrdal"],
    distanceKm: 227,
    estimatedMinutes: 175,
    prices: {"comfort": 592, "suv": 666, "van": 819}
  },
  {
    code: "keflavik-airport-olafsvik",
    origin: "Keflavík Airport",
    destination: "Ólafsvík",
    name: "Keflavík Airport → Ólafsvík",
    aliases: ["Olafsvik"],
    distanceKm: 236,
    estimatedMinutes: 180,
    prices: {"comfort": 616, "suv": 693, "van": 852}
  },
  {
    code: "keflavik-airport-blonduos",
    origin: "Keflavík Airport",
    destination: "Blönduós",
    name: "Keflavík Airport → Blönduós",
    aliases: ["Blonduos"],
    distanceKm: 286,
    estimatedMinutes: 208,
    prices: {"comfort": 749, "suv": 843, "van": 1035}
  },
  {
    code: "keflavik-airport-fjarargljufur-canyon",
    origin: "Keflavík Airport",
    destination: "Fjaðrárgljúfur Canyon",
    name: "Keflavík Airport → Fjaðrárgljúfur Canyon",
    aliases: ["Fjadrargljufur"],
    distanceKm: 295,
    estimatedMinutes: 223,
    prices: {"comfort": 772, "suv": 870, "van": 1067}
  },
  {
    code: "keflavik-airport-jokulsarlon",
    origin: "Keflavík Airport",
    destination: "Jökulsárlón",
    name: "Keflavík Airport → Jökulsárlón",
    aliases: ["Jokulsarlon", "Glacier Lagoon"],
    distanceKm: 416,
    estimatedMinutes: 309,
    prices: {"comfort": 1093, "suv": 1233, "van": 1509}
  },
  {
    code: "keflavik-airport-akureyri",
    origin: "Keflavík Airport",
    destination: "Akureyri",
    aliases: [],
    distanceKm: 430,
    estimatedMinutes: 311,
    prices: {"comfort": 1130, "suv": 1275, "van": 1560}
  },
  {
    code: "keflavik-airport-isafjorur",
    origin: "Keflavík Airport",
    destination: "Ísafjörður",
    aliases: ["Isafjordur"],
    distanceKm: 451,
    estimatedMinutes: 344,
    prices: {"comfort": 1186, "suv": 1338, "van": 1637}
  },
  {
    code: "keflavik-airport-goafoss-waterfall",
    origin: "Keflavík Airport",
    destination: "Goðafoss Waterfall",
    aliases: ["Godafoss"],
    distanceKm: 465,
    estimatedMinutes: 341,
    prices: {"comfort": 1223, "suv": 1380, "van": 1688}
  },
  {
    code: "keflavik-airport-hofn",
    origin: "Keflavík Airport",
    destination: "Höfn",
    aliases: ["Hofn"],
    distanceKm: 497,
    estimatedMinutes: 369,
    prices: {"comfort": 1308, "suv": 1476, "van": 1805}
  },
  {
    code: "keflavik-airport-lake-myvatn",
    origin: "Keflavík Airport",
    destination: "Lake Mývatn",
    aliases: ["Lake Myvatn", "Myvatn"],
    distanceKm: 504,
    estimatedMinutes: 371,
    prices: {"comfort": 1326, "suv": 1497, "van": 1830}
  },
  {
    code: "keflavik-airport-vestrahorn",
    origin: "Keflavík Airport",
    destination: "Vestrahorn",
    aliases: [],
    distanceKm: 505,
    estimatedMinutes: 382,
    prices: {"comfort": 1329, "suv": 1500, "van": 1834}
  },
  {
    code: "keflavik-airport-husavik",
    origin: "Keflavík Airport",
    destination: "Húsavík",
    aliases: ["Husavik"],
    distanceKm: 505,
    estimatedMinutes: 371,
    prices: {"comfort": 1329, "suv": 1500, "van": 1834}
  },
  {
    code: "keflavik-airport-dettifoss-waterfall",
    origin: "Keflavík Airport",
    destination: "Dettifoss Waterfall",
    aliases: ["Dettifoss"],
    distanceKm: 562,
    estimatedMinutes: 417,
    prices: {"comfort": 1480, "suv": 1671, "van": 2042}
  },
  {
    code: "keflavik-airport-asbyrgi",
    origin: "Keflavík Airport",
    destination: "Ásbyrgi",
    name: "Keflavík Airport → Ásbyrgi",
    aliases: ["Asbyrgi"],
    distanceKm: 567,
    estimatedMinutes: 417,
    prices: {"comfort": 1493, "suv": 1686, "van": 2060}
  },
  {
    code: "keflavik-airport-breidalsvik",
    origin: "Keflavík Airport",
    destination: "Breiðdalsvík",
    aliases: ["Breiddalsvik"],
    distanceKm: 636,
    estimatedMinutes: 481,
    prices: {"comfort": 1676, "suv": 1893, "van": 2312}
  },
  {
    code: "keflavik-airport-stulagil-canyon",
    origin: "Keflavík Airport",
    destination: "Stuðlagil Canyon",
    aliases: ["Studlagil"],
    distanceKm: 643,
    estimatedMinutes: 476,
    prices: {"comfort": 1695, "suv": 1914, "van": 2338}
  },
  {
    code: "keflavik-airport-egilsstair",
    origin: "Keflavík Airport",
    destination: "Egilsstaðir",
    aliases: ["Egilsstadir"],
    distanceKm: 677,
    estimatedMinutes: 495,
    prices: {"comfort": 1785, "suv": 2016, "van": 2462}
  },
  {
    code: "keflavik-airport-fjarabygg",
    origin: "Keflavík Airport",
    destination: "Fjarðabyggð",
    aliases: ["Fjardabyggd"],
    distanceKm: 699,
    estimatedMinutes: 521,
    prices: {"comfort": 1843, "suv": 2082, "van": 2542}
  },
];

// ==========================================
// TOURS
// ==========================================

const TOURS = [
  {
    code: "northern-lights",
    name: "Private Northern Lights Hunt from Reykjavik",
    durationHours: 4,
    prices: {
      suv: 308,
      van: 396
    }
  },
  {
    code: "classic-golden-circle",
    name: "Classic Golden Circle Private Tour",
    durationHours: 7,
    prices: {
      comfort: 665,
      suv: 765,
      van: 890
    }
  },
  {
    code: "south-coast",
    name: "Iceland South Coast Day Tour from Reykjavik",
    durationHours: 12,
    prices: {
      comfort: 990,
      suv: 1135,
      van: 1235
    }
  },
  {
    code: "golden-circle-hidden-gems",
    code: "golden-circle-hidden-gems",
    name: "The Ultimate Golden Circle & Hidden Gems Full Day Tour",
    durationHours: 9,
    prices: {
      comfort: 825,
      suv: 965,
      van: 1050
    }
  },
  {
    code: "glacier-lagoon-diamond-beach",
    name: "South Coast, Glacier Lagoon & Diamond Beach Tour",
    durationHours: 14,
    prices: {
      comfort: 1090,
      suv: 1255,
      van: 1335
    }
  },
  {
    code: "snaefellsnes",
    name: "Snaefellsnes Peninsula Private Tour - Full-Day Adventure",
    durationHours: 14,
    prices: {
      comfort: 1240,
      suv: 1425,
      van: 1500
    }
  },
  {
    code: "sliver-circle-fjord-fire",
    name: "Sliver Circle Fjord & Fire - Private Tour",
    durationHours: 6,
    prices: {
      comfort: 680,
      suv: 780,
      van: 885
    }
  },
  {
    code: "golden-circle-south-coast-mega",
    name: "Golden Circle & South Coast Mega Tour",
    durationHours: 14,
    prices: {
      comfort: 1095,
      suv: 1260,
      van: 1340
    }
  }
];

// ==========================================
// CHILD SEATS
// ==========================================

const CHILD_SEATS = [
  {
    code: "infant",
    name: "Infant Seat",
    ageRange: "0–12 months",
    weightRange: "up to 13 kg",
    priceEur: 0
  },
  {
    code: "convertible",
    name: "Convertible Seat",
    ageRange: "0–4 years",
    weightRange: "9–18 kg",
    priceEur: 0
  },
  {
    code: "booster",
    name: "Booster Seat",
    ageRange: "4–12 years",
    weightRange: "15–36 kg",
    priceEur: 0
  }
];

const ALLOWED_TRANSFER_TYPES = [
  "one_way",
  "return"
];

// ==========================================
// GENERAL HELPERS
// ==========================================

function json(res, status, data) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store"
  });

  res.end(body);
}

function round2(value) {
  return Math.round(
    (Number(value) + Number.EPSILON) * 100
  ) / 100;
}

function toIsk(eur) {
  return Math.round(Number(eur) * EUR_TO_ISK_RATE);
}

function cleanText(value, max = 500) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim().slice(0, max);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    String(value || "")
  );
}

function getIcelandDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter(part => part.type !== "literal").map(part => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);

  const date = new Date(
    Date.UTC(year, month - 1, day)
  );

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function validTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(
    String(value || "")
  );
}

function normalizeTime(value) {
  return String(value).length === 5
    ? `${value}:00`
    : String(value);
}

// Iceland uses UTC year-round.
function parsePickup(date, time) {
  return new Date(
    `${date}T${normalizeTime(time)}Z`
  );
}

function isOperatingTime(time) {
  if (!validTime(time)) {
    return false;
  }

  const hour = Number(String(time).slice(0, 2));

  return (
    hour >= OPENING_HOUR &&
    hour < CLOSING_HOUR
  );
}

function validateFutureDateTime(date, time, label = "Pickup") {
  if (!validDate(date) || !validTime(time)) {
    const error = new Error(
      `${label}: please enter a valid date and time.`
    );

    error.status = 400;
    throw error;
  }

  if (!isOperatingTime(time)) {
    const error = new Error(
      `${label} must be within the 24-hour service window (Iceland time).`
    );

    error.status = 400;
    throw error;
  }

  const dateTime = parsePickup(date, time);

  if (dateTime.getTime() <= Date.now()) {
    const error = new Error(
      `${label} date and time must be in the future.`
    );

    error.status = 400;
    throw error;
  }

  return dateTime;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let tooLarge = false;

    req.on("data", chunk => {
      if (tooLarge) return;

      raw += chunk;

      if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
        tooLarge = true;

        const error = new Error(
          "Request body is too large."
        );

        error.status = 413;
        reject(error);
        req.destroy();
      }
    });

    req.on("end", () => {
      if (tooLarge) return;

      if (!raw) {
        return resolve({});
      }

      try {
        const parsed = JSON.parse(raw);

        if (
          !parsed ||
          typeof parsed !== "object" ||
          Array.isArray(parsed)
        ) {
          throw new Error("Invalid JSON object.");
        }

        resolve(parsed);
      } catch (_) {
        const error = new Error(
          "Request body must be a valid JSON object."
        );

        error.status = 400;
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function findVehicle(code) {
  const key = cleanText(code, 50)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  return VEHICLES.find(vehicle =>
    vehicle.code === key ||
    vehicle.name.toLowerCase() === key.replace(/_/g, " ")
  );
}

function getCatalogItem(type, code) {
  if (type === "tour") {
    return TOURS.find(item => item.code === code);
  }

  if (type === "route") {
    return ROUTES.find(item => item.code === code);
  }

  return null;
}

function makeBookingReference() {
  return (
    "IT-" +
    new Date().toISOString()
      .slice(2, 10)
      .replace(/-/g, "") +
    "-" +
    crypto.randomBytes(3).toString("hex").toUpperCase()
  );
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]
  );
}


function normalizePlaceName(value) {
  return cleanText(value, 300)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function resolveTransferRoute(input) {
  const routeCode = cleanText(input.route_code, 120);
  if (routeCode) {
    return ROUTES.find(route => route.code === routeCode) || null;
  }

  const pickup = normalizePlaceName(
    input.pickup_location || input.pickup || input.origin
  );
  const destination = normalizePlaceName(
    input.destination || input.dropoff_location || input.dropoff
  );

  if (!pickup || !destination) return null;

  const matches = (value, names) => names
    .filter(Boolean)
    .map(normalizePlaceName)
    .some(name => value === name || value.includes(name) || name.includes(value));

  return ROUTES.find(route => {
    const routeOrigin = normalizePlaceName(route.origin || "Keflavík Airport");
    const isKeflavikRoute = routeOrigin.includes("keflavik airport");
    const originMatches = isKeflavikRoute
      ? pickup.includes("keflavik") && pickup.includes("airport")
      : matches(pickup, [route.origin, ...(route.originAliases || [])]);
    const destinations = [route.destination, ...(route.aliases || [])];
    return originMatches && matches(destination, destinations);
  }) || null;
}

// ==========================================
// PRICE CALCULATION
// ==========================================

function calculateQuote(input) {
  const kind = cleanText(
    input.booking_kind ||
    input.service_type ||
    "transfer",
    50
  ).toLowerCase();

  const itemType = kind.includes("tour") ? "tour" : "route";

  const vehicle = findVehicle(
    input.vehicle_code ||
    input.vehicle_type ||
    input.vehicle
  );

  if (!vehicle) {
    throw new Error(
      "Please select one of the four available vehicles."
    );
  }

  const passengers = Number(
    input.passengers ??
    input.max_passengers ??
    1
  );

  if (
    !Number.isInteger(passengers) ||
    passengers < vehicle.minPassengers ||
    passengers > vehicle.maxPassengers
  ) {
    throw new Error(
      `${vehicle.name} supports ${vehicle.minPassengers}–${vehicle.maxPassengers} passengers.`
    );
  }

  const largeBags = Number(
    input.large_bags ??
    input.luggage ??
    0
  );

  const handBags = Number(
    input.hand_bags ?? 0
  );

  if (
    !Number.isInteger(largeBags) ||
    largeBags < 0 ||
    largeBags > vehicle.largeBags
  ) {
    throw new Error(
      `${vehicle.name} supports up to ${vehicle.largeBags} large bags.`
    );
  }

  if (
    !Number.isInteger(handBags) ||
    handBags < 0 ||
    handBags > vehicle.handBags
  ) {
    throw new Error(
      `${vehicle.name} supports up to ${vehicle.handBags} hand bags.`
    );
  }

  let item = null;
  let eur = null;

  if (itemType === "tour") {
    const requestedTourCode = cleanText(
      input.tour_code || input.package_type || kind,
      100
    ).toLowerCase();

    const tourAliases = {
      classic: "classic-golden-circle",
      classic_golden_circle: "classic-golden-circle",
      golden_circle_tour: "classic-golden-circle",
      south_coast: "south-coast",
      south_coast_tour: "south-coast",
      northern_lights_tour: "northern-lights",
      magical_northern_lights_tour: "northern-lights",
      glacier_lagoon: "glacier-lagoon-diamond-beach",
      snaefellsnes_peninsula: "snaefellsnes",
      silver_circle: "sliver-circle-fjord-fire",
      silver_circle_fjord_fire: "sliver-circle-fjord-fire"
    };

    const normalizedTourCode =
      tourAliases[requestedTourCode] || requestedTourCode.replace(/_/g, "-");

    item = getCatalogItem("tour", normalizedTourCode);

    if (!item) {
      throw new Error(
        "The selected tour is not in the approved tour list."
      );
    }

    eur = item.prices[vehicle.code];

  } else if (itemType === "route") {
    item = resolveTransferRoute(input);

    if (!item) {
      throw new Error(
        "A fixed fare is not available for this pickup and destination. The published fare table currently covers Keflavík Airport departures only. Please select a listed destination or contact us for a quote."
      );
    }

    eur = item.prices[vehicle.code];

  }

  if (eur === undefined || eur === null) {
    throw new Error(
      `${vehicle.name} is not available for this route or tour.`
    );
  }

  // Child seat validation.
  const childSeats = [];

  if (
    input.child_seats !== undefined &&
    !Array.isArray(input.child_seats)
  ) {
    throw new Error("Child seats must be provided as a list.");
  }

  for (const seat of (input.child_seats || [])) {
    const type = cleanText(
      seat.type || seat.code,
      30
    );

    const quantity = Number(
      seat.quantity === undefined ? 1 : seat.quantity
    );

    const age = cleanText(seat.age, 30);

    if (!CHILD_SEATS.some(item => item.code === type)) {
      throw new Error(
        "One of the selected child seat types is invalid."
      );
    }

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 3
    ) {
      throw new Error(
        "Each child seat quantity must be between 1 and 3."
      );
    }

    childSeats.push({
      type,
      age,
      quantity
    });
  }

  const transferType = cleanText(
    input.transfer_type || "one_way",
    30
  );

  if (!ALLOWED_TRANSFER_TYPES.includes(transferType)) {
    throw new Error("Invalid transfer type.");
  }

  if (transferType === "return") {
    throw new Error(
      "Return-trip pricing is not enabled until both journey legs have verified fares. Please book each leg separately or contact us for a confirmed return quote."
    );
  }

  const discountCode = cleanText(
    input.discount_code,
    50
  );

  // Discounts are not enabled yet.
  const discountAmountEur = 0;

  const totalEur = round2(
    Number(eur) - discountAmountEur
  );

  return {
    bookingKind: itemType,
    item,
    vehicle,
    passengers,
    largeBags,
    handBags,
    childSeats,
    transferType,
    basePriceEur: round2(eur),
    discountCode,
    discountAmountEur,
    totalEur,
    totalIsk: toIsk(totalEur),
    currency: "ISK",
    eurToIskRate: EUR_TO_ISK_RATE
  };
}

// ==========================================
// AVAILABILITY
// ==========================================

async function getAvailability(date) {
  if (!validDate(date)) {
    const error = new Error(
      "Please provide a valid date in YYYY-MM-DD format."
    );

    error.status = 400;
    throw error;
  }

  if (date < getIcelandDateString()) {
    const error = new Error(
      "Availability cannot be checked for a past date."
    );

    error.status = 400;
    throw error;
  }

  const { data, error } = await supabase
    .from("bookings")
    .select("pickup_time,status")
    .eq("pickup_date", date)
    .neq("status", "cancelled");

  if (error) {
    const dbError = new Error(
      `Could not check availability: ${error.message}`
    );

    dbError.status = 503;
    throw dbError;
  }

  const counts = {};

  for (let hour = OPENING_HOUR; hour < CLOSING_HOUR; hour++) {
    counts[String(hour).padStart(2, "0") + ":00"] = 0;
  }

  for (const booking of (data || [])) {
    if (!booking.pickup_time) continue;

    const hour = String(
      booking.pickup_time
    ).slice(0, 2);

    const slot = `${hour}:00`;

    if (Object.prototype.hasOwnProperty.call(counts, slot)) {
      counts[slot]++;
    }
  }

  const slots = Object.entries(counts).map(
    ([time, booked]) => {
      const remaining = Math.max(
        0,
        MAX_BOOKINGS_PER_HOUR - booked
      );

      return {
        time,
        booked,
        remaining,
        available: remaining > 0
      };
    }
  );

  return {
    date,
    timeZone: TIME_ZONE,
    openingTime: "00:00",
    closingTime: "24:00",
    maxBookingsPerHour: MAX_BOOKINGS_PER_HOUR,
    slots
  };
}

// ==========================================
// BOOKING EMAIL
// ==========================================

async function sendBookingEmail(booking) {
  const configured =
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.EMAIL_FROM;

  if (!configured || !nodemailer) {
    return {
      sent: false,
      reason: "Email service is not configured."
    };
  }

  const port = Number(
    process.env.SMTP_PORT || 587
  );

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  const dateTime =
    `${booking.pickup_date} ${String(booking.pickup_time).slice(0, 5)} (Iceland time)`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#293c2e">
      <h2>We received your booking request</h2>

      <p>Hello ${escapeHtml(booking.full_name)},</p>

      <p>
        Your booking request has been received.
        It is <b>pending payment/confirmation</b>.
        This email is not a paid ticket.
      </p>

      <hr>

      <p><b>Reference:</b> ${escapeHtml(booking.booking_reference)}</p>
      <p><b>Service:</b> ${escapeHtml(booking.service_type || "Private transfer")}</p>
      <p><b>Pickup:</b> ${escapeHtml(booking.pickup_location)}</p>
      <p><b>Drop-off:</b> ${escapeHtml(booking.destination)}</p>
      <p><b>Date/time:</b> ${escapeHtml(dateTime)}</p>
      <p><b>Passengers:</b> ${Number(booking.passengers)}</p>
      <p><b>Vehicle:</b> ${escapeHtml(booking.vehicle_name || "")}</p>

      <p>
        <b>Amount:</b>
        ${Number(booking.price).toLocaleString("en-US")} ISK
        (${Number(booking.price_eur).toFixed(2)} EUR)
      </p>

      <p>
        We will send a further confirmation when payment is verified.
      </p>

      <p>ICELAND TRANSFER</p>
    </div>
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: booking.email,
    subject: `Booking request received — ${booking.booking_reference}`,
    html
  });

  return { sent: true };
}

// ==========================================
// CREATE BOOKING
// ==========================================

async function createBooking(input) {
  const fullName = cleanText(
    input.full_name || input.name,
    160
  );

  const email = cleanText(
    input.email,
    254
  ).toLowerCase();

  const phone = cleanText(
    input.phone,
    50
  );

  const pickup = cleanText(
    input.pickup_location || input.pickup,
    300
  );

  const destination = cleanText(
    input.destination ||
    input.dropoff_location ||
    input.dropoff,
    300
  );

  const pickupDate = cleanText(
    input.pickup_date || input.date,
    10
  );

  const pickupTime = cleanText(
    input.pickup_time || input.time,
    8
  );

  if (
    !fullName ||
    !isEmail(email) ||
    !phone ||
    !pickup ||
    !destination
  ) {
    const error = new Error(
      "Please complete your name, valid email, phone, pickup and drop-off."
    );

    error.status = 400;
    throw error;
  }

  const pickupAt = validateFutureDateTime(
    pickupDate,
    pickupTime,
    "Pickup"
  );

  const quote = calculateQuote(input);

  // Validate return date and ensure it is after pickup.
  if (quote.transferType === "return") {
    const returnAt = parsePickup(
      input.return_date,
      input.return_time
    );

    if (returnAt.getTime() <= pickupAt.getTime()) {
      const error = new Error(
        "Return date and time must be later than pickup."
      );

      error.status = 400;
      throw error;
    }
  }

  const cancellationToken =
    crypto.randomBytes(32).toString("hex");

  const bookingReference = makeBookingReference();

  const serviceName =
    quote.item?.name || "Private transfer";

  const durationHours =
    quote.item?.durationHours || null;

  const returnDate =
    quote.transferType === "return"
      ? input.return_date
      : null;

  const returnTime =
    quote.transferType === "return"
      ? normalizeTime(input.return_time)
      : null;

  const row = {
    booking_reference: bookingReference,
    full_name: fullName,
    email,
    phone,

    pickup_location: pickup,
    destination,

    pickup_date: pickupDate,
    pickup_time: normalizeTime(pickupTime),

    passengers: quote.passengers,

    luggage: quote.largeBags,
    large_bags: quote.largeBags,
    hand_bags: quote.handBags,

    flight_number:
      cleanText(input.flight_number, 80) || null,

    special_requests:
      cleanText(
        input.special_requests || input.notes,
        2000
      ) || null,

    price: quote.totalIsk,
    price_eur: quote.totalEur,
    base_price: toIsk(quote.basePriceEur),
    currency: "ISK",

    status: "pending",
    payment_status: "unpaid",

    cancellation_token: cancellationToken,
    cancelled_at: null,

    service_type: serviceName,

    package_type:
      quote.bookingKind === "tour"
        ? quote.item.code
        : null,

    addons: quote.childSeats,
    child_seats: quote.childSeats,
    extras_total: 0,

    service_duration_hours: durationHours,

    selected_stops:
      Array.isArray(input.selected_stops)
        ? input.selected_stops
        : [],

    return_date: returnDate,
    return_time: returnTime,
    transfer_type: quote.transferType,

    vehicle_code: quote.vehicle.code,
    vehicle_name: quote.vehicle.name,

    billing_country:
      cleanText(
        input.billing_country ||
        input.country_of_origin,
        100
      ) || null,

    billing_city:
      cleanText(input.billing_city, 120) || null,

    billing_address:
      cleanText(input.billing_address, 250) || null,

    billing_postcode:
      cleanText(input.billing_postcode, 40) || null,

    discount_code:
      quote.discountCode || null,

    discount_amount: 0,

    confirmation_email_sent_at: null
  };

  const { data, error } = await supabase
    .from("bookings")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    if (
      error.code === "P0001" &&
      String(error.message || "").includes(
        "Maximum 5 bookings"
      )
    ) {
      const capacityError = new Error(
        `This pickup hour is full. Maximum ${MAX_BOOKINGS_PER_HOUR} bookings are allowed per hour. Please choose another time.`
      );

      capacityError.status = 409;
      throw capacityError;
    }

    console.error("Supabase insert error:", error);

    const dbError = new Error(
      `Database could not save the booking: ${error.message}`
    );

    dbError.status = 500;
    throw dbError;
  }

  const cancellationUrl =
    `${PUBLIC_SERVER_URL}/cancel/${cancellationToken}`;

  let emailResult = {
    sent: false,
    reason: "Email not configured."
  };

  try {
    emailResult = await sendBookingEmail(data);

    if (emailResult.sent) {
      const { error: emailUpdateError } = await supabase
        .from("bookings")
        .update({
          confirmation_email_sent_at:
            new Date().toISOString()
        })
        .eq("id", data.id);

      if (emailUpdateError) {
        console.error(
          "Could not update email timestamp:",
          emailUpdateError.message
        );
      }
    }
  } catch (emailError) {
    console.error(
      "Booking email failed:",
      emailError.message
    );

    emailResult = {
      sent: false,
      reason: "Booking saved, but email delivery failed."
    };
  }

  return {
    booking: {
      id: data.id,
      reference: bookingReference,
      status: "pending",
      paymentStatus: "unpaid",

      fullName,
      email,
      phone,

      pickup,
      destination,

      pickupDate,
      pickupTime: normalizeTime(pickupTime),

      returnDate,
      returnTime,

      transferType: quote.transferType,

      vehicle: quote.vehicle.name,
      passengers: quote.passengers,

      price: {
        currency: "ISK",
        amount: quote.totalIsk,
        eur: quote.totalEur,
        rate: EUR_TO_ISK_RATE
      },

      cancellationUrl,
      cancellationToken
    },

    email: emailResult,

    message:
      "Booking request saved. It is pending payment/confirmation and is not confirmed as paid."
  };
}

// ==========================================
// CANCEL BOOKING
// ==========================================

async function cancelBooking(token) {
  const cleanToken = cleanText(token, 128);

  if (!/^[a-f0-9]{64}$/i.test(cleanToken)) {
    const error = new Error(
      "Invalid cancellation link."
    );

    error.status = 400;
    throw error;
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("cancellation_token", cleanToken)
    .maybeSingle();

  if (error) {
    const dbError = new Error(error.message);
    dbError.status = 500;
    throw dbError;
  }

  if (!booking) {
    const error = new Error("Booking not found.");
    error.status = 404;
    throw error;
  }

  if (booking.status === "cancelled") {
    return {
      cancelled: true,
      message: "This booking is already cancelled."
    };
    }

  const pickupAt = parsePickup(
    booking.pickup_date,
    String(booking.pickup_time).slice(0, 5)
  );

  const hoursLeft =
    (pickupAt.getTime() - Date.now()) / 3600000;

  if (hoursLeft < CANCELLATION_HOURS) {
    const error = new Error(
      `Cancellation is available until ${CANCELLATION_HOURS} hours before pickup.`
    );

    error.status = 400;
    throw error;
  }

  const { error: updateError } = await supabase
    .from("bookings")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString()
    })
    .eq("id", booking.id)
    .neq("status", "cancelled");

  if (updateError) {
    const dbError = new Error(updateError.message);
    dbError.status = 500;
    throw dbError;
  }

  return {
    cancelled: true,
    bookingId: booking.id,
    reference: booking.booking_reference,
    message: "Booking cancelled successfully."
  };
}

// ==========================================
// CANCELLATION PAGE
// ==========================================

function cancellationPage(token) {
  const safeToken = escapeHtml(token);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cancel Booking | Iceland Transfer</title>
<style>
*{box-sizing:border-box}
body{
  margin:0;
  min-height:100vh;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:20px;
  background:#f5f1e8;
  font-family:Arial,sans-serif;
  color:#293c2e
}
.card{
  width:100%;
  max-width:480px;
  background:#fffdf9;
  padding:35px;
  border-radius:18px;
  text-align:center;
  box-shadow:0 10px 35px rgba(0,0,0,.08)
}
h1{font-size:25px;margin-top:0}
p{line-height:1.7;color:#555}
button{
  border:0;
  border-radius:8px;
  background:#465b45;
  color:white;
  padding:14px 24px;
  font-size:15px;
  cursor:pointer
}
button:disabled{opacity:.6;cursor:not-allowed}
#message{margin-top:20px;font-weight:bold}
</style>
</head>
<body>
<div class="card">
<h1>ICELAND TRANSFER</h1>
<h2>Cancel your booking</h2>
<p>
If you cancel, your booking will be marked as cancelled.
Cancellation is available until 24 hours before pickup.
</p>
<button id="cancelButton">Confirm Cancellation</button>
<div id="message"></div>
</div>

<script>
const token = "${safeToken}";
const button = document.getElementById("cancelButton");
const message = document.getElementById("message");

button.addEventListener("click", async () => {
  if (!confirm("Are you sure you want to cancel this booking?")) {
    return;
  }

  button.disabled = true;
  message.textContent = "Processing cancellation...";

  try {
    const response = await fetch("/api/bookings/cancel", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({token})
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Cancellation failed.");
    }

    message.textContent = result.message;
    button.style.display = "none";

  } catch (error) {
    message.textContent = error.message;
    button.disabled = false;
  }
});
</script>
</body>
</html>`;
}

// ==========================================
// GOOGLE MAPS ROUTE
// ==========================================

async function googleRoute(
  origin,
  destination,
  intermediates = []
) {
  if (!GOOGLE_MAPS_API_KEY) {
    const error = new Error(
      "Google Maps is not configured. Add GOOGLE_MAPS_API_KEY to the server environment."
    );

    error.status = 503;
    throw error;
  }

  const body = {
    origin: { address: origin },
    destination: { address: destination },

    intermediates: intermediates.map(address => ({
      address: cleanText(address, 300)
    })),

    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    units: "METRIC"
  };

  const response = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask":
          "routes.distanceMeters,routes.duration"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    }
  );

  const data = await response.json();

  if (!response.ok || !data.routes?.[0]) {
    const error = new Error(
      data.error?.message ||
      "Google Maps could not calculate this route."
    );

    error.status = response.status || 502;
    throw error;
  }

  const route = data.routes[0];

  return {
    distanceKm: round2(
      route.distanceMeters / 1000
    ),

    durationMinutes: Math.round(
      parseFloat(route.duration) / 60
    )
  };
}

// ==========================================
// PLACES SEARCH — PHOTON / OPENSTREETMAP
// ==========================================

async function searchPlaces(query) {
  const q = cleanText(query, 120);

  if (q.length < 3) {
    return [];
  }

  const photonUrl = new URL(
    "https://photon.komoot.io/api/"
  );

  photonUrl.searchParams.set("q", q);
  photonUrl.searchParams.set("limit", "8");
  photonUrl.searchParams.set("lang", "en");

  photonUrl.searchParams.set(
    "bbox",
    "-25.0,63.0,-12.0,67.5"
  );

  let response;

  try {
    response = await fetch(photonUrl, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "ICELAND-TRANSFER-Booking/2.1"
      },
      signal: AbortSignal.timeout(10000)
    });
  } catch (_) {
    const error = new Error(
      "Place search is temporarily unavailable. Please try again."
    );

    error.status = 502;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(
      "Place search is temporarily unavailable."
    );

    error.status = 502;
    throw error;
  }

  let data;

  try {
    data = await response.json();
  } catch (_) {
    const error = new Error(
      "The place search service returned an invalid response."
    );

    error.status = 502;
    throw error;
  }

  return (data.features || [])
    .map(feature => {
      const properties = feature.properties || {};
      const coordinates =
        feature.geometry?.coordinates || [];

      const longitude = Number(coordinates[0]);
      const latitude = Number(coordinates[1]);

      const addressParts = [
        properties.name,
        properties.street,
        properties.housenumber,
        properties.city,
        properties.state,
        properties.country
      ].filter(Boolean);

      return {
        name: properties.name || "Unnamed place",

        address: [
          ...new Set(addressParts)
        ].join(", "),

        latitude,
        longitude,

        osmId: properties.osm_id || null,
        osmType: properties.osm_type || null
      };
    })
    .filter(place =>
      Number.isFinite(place.latitude) &&
      Number.isFinite(place.longitude) &&

      // Keep results within Iceland's approximate bounds.
      place.latitude >= 63 &&
      place.latitude <= 67.5 &&
      place.longitude >= -25 &&
      place.longitude <= -12
    );
}

// ==========================================
// HTTP SERVER
// ==========================================

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization"
    });

    return res.end();
  }

  const url = new URL(
    req.url,
    `http://${req.headers.host || "localhost"}`
  );

  try {

    // ======================================
    // HOME
    // ======================================

    if (
      req.method === "GET" &&
      url.pathname === "/"
    ) {
      return json(res, 200, {
        name: "ICELAND TRANSFER API",
        status: "running",
        version: "2.2.1"
      });
    }

    // ======================================
    // HEALTH CHECK
    // ======================================

    if (
      req.method === "GET" &&
      url.pathname === "/health"
    ) {
      const { error } = await supabase
        .from("bookings")
        .select("id", {
          head: true,
          count: "exact"
        });

      return json(res, error ? 503 : 200, {
        ok: !error,
        database: error ? "error" : "connected",
        version: "2.2.1"
      });
    }

    // ======================================
    // CATALOG
    // ======================================

    if (
      req.method === "GET" &&
      url.pathname === "/api/catalog"
    ) {
      return json(res, 200, {
        currency: "ISK",
        secondaryCurrency: "EUR",
        eurToIskRate: EUR_TO_ISK_RATE,

        rateDate: process.env.EUR_TO_ISK_RATE
          ? "configured in environment"
          : "2026-11-24 reference rate",

        paymentEnabled: false,
        serviceAvailability: "24/7",
        routeFareCoverage: "Published Keflavík Airport departure fares only; unlisted directions are not guessed.",
        routeCount: ROUTES.length,
        tourCount: TOURS.length,

        vehicles: VEHICLES.map(vehicle => ({
          ...vehicle,
          fromIsk: toIsk(vehicle.fromEur),
          fromCurrency: "EUR"
        })),

        routes: ROUTES.map(route => ({
          ...route,

          prices: Object.fromEntries(
            Object.entries(route.prices).map(
              ([code, price]) => [
                code,
                {
                  eur: price,
                  isk: toIsk(price)
                }
              ]
            )
          )
        })),

        tours: TOURS.map(tour => ({
          ...tour,

          prices: Object.fromEntries(
            Object.entries(tour.prices).map(
              ([code, price]) => [
                code,
                {
                  eur: price,
                  isk: toIsk(price)
                }
              ]
            )
          )
        })),

        childSeats: CHILD_SEATS,

        policies: {
          cancellationHours: CANCELLATION_HOURS,
          maxBookingsPerHour: MAX_BOOKINGS_PER_HOUR,
          openingTime: "00:00",
          closingTime: "24:00",
          timeZone: TIME_ZONE,
          childSeatsFree: true
        }
      });
    }

    // ======================================
    // AVAILABILITY
    // GET /api/availability?date=YYYY-MM-DD
    // ======================================

    if (
      req.method === "GET" &&
      url.pathname === "/api/availability"
    ) {
      const date = cleanText(
        url.searchParams.get("date"),
        10
      );

      const result = await getAvailability(date);

      return json(res, 200, result);
    }

    // ======================================
    // PRICE QUOTE
    // ======================================

    if (
      req.method === "POST" &&
      url.pathname === "/api/quote"
    ) {
      const input = await readBody(req);
      const quote = calculateQuote(input);

      return json(res, 200, {
        bookingKind: quote.bookingKind,
        item: quote.item,
        vehicle: quote.vehicle,

        passengers: quote.passengers,
        largeBags: quote.largeBags,
        handBags: quote.handBags,

        childSeats: quote.childSeats,
        transferType: quote.transferType,

        basePrice: {
          eur: quote.basePriceEur,
          isk: toIsk(quote.basePriceEur)
        },

        total: {
          currency: "ISK",
          isk: quote.totalIsk,
          eur: quote.totalEur
        },
        price_isk: quote.totalIsk,
        price_eur: quote.totalEur,
        quote: {
          price_isk: quote.totalIsk,
          price_eur: quote.totalEur,
          currency: "ISK"
        },

        eurToIskRate: EUR_TO_ISK_RATE,

        note:
          "Transfer prices are fixed only for routes present in the published fare catalogue. Unlisted routes and reverse directions are not assigned an estimated fare."
      });
    }

    // ======================================
    // PLACES SEARCH
    // ======================================

    if (
      req.method === "GET" &&
      url.pathname === "/api/places/search"
    ) {
      const query = cleanText(
        url.searchParams.get("q"),
        120
      );

      const places = await searchPlaces(query);

      return json(res, 200, {
        success: true,
        places,

        attribution:
          "Place data © OpenStreetMap contributors, via Photon"
      });
    }

    // ======================================
    // GOOGLE MAPS ROUTE
    // ======================================

    if (
      req.method === "POST" &&
      url.pathname === "/api/maps/route"
    ) {
      const input = await readBody(req);

      const origin = cleanText(input.origin, 300);
      const destination = cleanText(
        input.destination,
        300
      );

      if (!origin || !destination) {
        const error = new Error(
          "Origin and destination are required."
        );

        error.status = 400;
        throw error;
      }

      const waypoints = Array.isArray(input.waypoints)
        ? input.waypoints
            .slice(0, 8)
            .map(value => cleanText(value, 300))
            .filter(Boolean)
        : [];

      const result = await googleRoute(
        origin,
        destination,
        waypoints
      );

      return json(res, 200, result);
    }

    // ======================================
    // CREATE BOOKING
    // ======================================

    if (
      req.method === "POST" &&
      url.pathname === "/api/bookings"
    ) {
      const input = await readBody(req);
      const result = await createBooking(input);

      return json(res, 201, result);
    }

    // ======================================
    // CANCEL BOOKING — POST
    // ======================================

    if (
      req.method === "POST" &&
      url.pathname === "/api/bookings/cancel"
    ) {
      const input = await readBody(req);

      const result = await cancelBooking(
        input.token ||
        input.cancellation_token
      );

      return json(res, 200, result);
    }

    // ======================================
    // CANCEL BOOKING BY TOKEN
    // ======================================

    const cancelMatch = url.pathname.match(
      /^\/api\/bookings\/cancel\/([a-f0-9]{64})$/i
    );

    if (
      req.method === "POST" &&
      cancelMatch
    ) {
      const result = await cancelBooking(
        cancelMatch[1]
      );

      return json(res, 200, result);
    }

    // ======================================
    // CUSTOMER CANCELLATION PAGE / ACTION
    // GET shows the page; POST performs the cancellation.
    // ======================================

    const publicCancelMatch = url.pathname.match(
      /^\/cancel\/([a-f0-9]{64})$/i
    );

    if (req.method === "POST" && publicCancelMatch) {
      const result = await cancelBooking(publicCancelMatch[1]);
      return json(res, 200, result);
    }

    if (
      req.method === "GET" &&
      publicCancelMatch
    ) {
      const html = cancellationPage(
        publicCancelMatch[1]
      );

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });

      return res.end(html);
    }

    // ======================================
    // TEYA PAYMENT — DISABLED
    // ======================================

    if (
      req.method === "POST" &&
      url.pathname === "/api/payments/teya/create-session"
    ) {
      return json(res, 501, {
        paymentEnabled: false,

        error:
          "Teya live payments are not enabled yet.",

        reason:
          "Merchant API credentials and the correct Teya integration contract are required. No card details should be collected by this server."
      });
    }

    // ======================================
    // UNKNOWN ROUTE
    // ======================================

    return json(res, 404, {
      error: "Endpoint not found."
    });

  } catch (error) {
    console.error(
      "API error:",
      error.message
    );

    return json(
      res,
      error.status || 400,
      {
        error:
          error.message ||
          "Unexpected server error."
      }
    );
  }
});

// ==========================================
// START SERVER
// ==========================================

server.listen(PORT, () => {
  console.log(
    `ICELAND TRANSFER API v2.2.1 running on port ${PORT}`
  );

  console.log(
    `Operating hours: 24/7 Iceland time`
  );

  console.log(
    `Maximum bookings per pickup hour: ${MAX_BOOKINGS_PER_HOUR}`
  );

  console.log(
    `Payments enabled: NO`
  );
});
/**
 * ICELAND TRANSFER — booking API
 * Node.js 18+ / CommonJS
 *
 * Required:
 *   SUPABASE_URL
 *   SUPABASE_SECRET_KEY
 *
 * Optional integrations:
 *   GOOGLE_MAPS_API_KEY
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM
 *   EUR_TO_ISK_RATE (default reference rate: 137.20, dated 2026-11-24)
 *   PUBLIC_SERVER_URL
 *
 * IMPORTANT:
 * Teya live card processing is deliberately NOT simulated.
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

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const EUR_TO_ISK_RATE = Number(process.env.EUR_TO_ISK_RATE || 137.20);
const MAX_BODY_BYTES = 1024 * 1024;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env");
  process.exit(1);
}

if (!Number.isFinite(EUR_TO_ISK_RATE) || EUR_TO_ISK_RATE <= 0) {
  console.error("EUR_TO_ISK_RATE must be a positive number.");
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
    name: "Keflavík Airport → Blue Lagoon",
    distanceKm: 22,
    estimatedMinutes: 19,
    prices: {
      comfort: 90,
      suv: 105,
      van: 115
    }
  },
  {
    code: "blue-lagoon-reykjavik",
    name: "Blue Lagoon → Reykjavík",
    distanceKm: 49,
    estimatedMinutes: 44,
    prices: {
      standard: 110,
      comfort: 136,
      suv: 150,
      van: 191
    }
  },
  {
    code: "airport-blue-lagoon-reykjavik",
    name: "Keflavík Airport → Blue Lagoon → Reykjavík",
    distanceKm: null,
    estimatedMinutes: null,
    durationLabel: "About 4 hours",
    prices: {
      comfort: 387,
      suv: 421,
      van: 456
    }
  },
  {
    code: "reykjavik-blue-lagoon-airport",
    name: "Reykjavík → Blue Lagoon → Keflavík Airport",
    distanceKm: null,
    estimatedMinutes: null,
    durationLabel: "About 4 hours",
    prices: {
      comfort: 387,
      suv: 421,
      van: 456
    }
  }
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

const ALLOWED_TRANSFER_TYPES = ["one_way", "return"];
const CANCELLATION_HOURS = 24;
const MAX_BOOKINGS_PER_HOUR = 5;

// ==========================================
// GENERAL HELPERS
// ==========================================

function json(res, status, data) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  });

  res.end(body);
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function toIsk(eur) {
  return Math.round(Number(eur) * EUR_TO_ISK_RATE);
}

function cleanText(v, max = 500) {
  if (v === undefined || v === null) return "";
  return String(v).trim().slice(0, max);
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || ""));
}

function validDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) &&
    !Number.isNaN(Date.parse(v + "T12:00:00Z"));
}

function validTime(v) {
  return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(v || ""));
}

function parsePickup(date, time) {
  const hhmm = String(time).length === 5
    ? `${time}:00`
    : time;

  return new Date(`${date}T${hhmm}Z`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", chunk => {
      raw += chunk;

      if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!raw) return resolve({});

      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    req.on("error", reject);
  });
}

function findVehicle(code) {
  const key = cleanText(code, 40)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  return VEHICLES.find(v =>
    v.code === key ||
    v.name.toLowerCase() === key.replace(/_/g, " ")
  );
}

function getCatalogItem(type, code) {
  if (type === "tour") {
    return TOURS.find(x => x.code === code);
  }

  if (type === "route") {
    return ROUTES.find(x => x.code === code);
  }

  return null;
}

// ==========================================
// PRICE CALCULATION
// ==========================================

function calculateQuote(input) {
  const kind = cleanText(
    input.booking_kind || input.service_type || "transfer",
    30
  ).toLowerCase();

  const itemType = kind.includes("tour")
    ? "tour"
    : (input.route_code ? "route" : "transfer");

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
    input.passengers ?? input.max_passengers ?? 1
  );

  if (
    !Number.isInteger(passengers) ||
    passengers < 1 ||
    passengers > vehicle.maxPassengers
  ) {
    throw new Error(
      `${vehicle.name} supports 1–${vehicle.maxPassengers} passengers.`
    );
  }

  const largeBags = Number(
    input.large_bags ?? input.luggage ?? 0
  );

  const handBags = Number(input.hand_bags ?? 0);

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

  let eur = null;
  let item = null;

  if (itemType === "tour") {
    item = getCatalogItem(
      "tour",
      cleanText(input.tour_code || input.package_type, 80)
    );

    if (!item) {
      throw new Error(
        "The selected tour is not in the approved tour list."
      );
    }

    eur = item.prices[vehicle.code];

  } else if (itemType === "route") {
    item = getCatalogItem(
      "route",
      cleanText(input.route_code, 80)
    );

    if (!item) {
      throw new Error(
        "The selected route is not in the approved route list."
      );
    }

    eur = item.prices[vehicle.code];

  } else {
    eur = vehicle.fromEur;
  }

  if (eur === undefined || eur === null) {
    throw new Error(
      `${vehicle.name} is not available for this route/tour. Please choose another vehicle.`
    );
  }

  const childSeats = Array.isArray(input.child_seats)
    ? input.child_seats.slice(0, 3).map(s => ({
        type: cleanText(s.type || s.code, 30),
        age: cleanText(s.age, 30),
        quantity: Math.max(
          1,
          Math.min(3, Number(s.quantity || 1))
        )
      }))
    : [];

  for (const seat of childSeats) {
    if (!CHILD_SEATS.some(s => s.code === seat.type)) {
      throw new Error(
        "One of the selected child seat types is invalid."
      );
    }
  }

  const transferType = ALLOWED_TRANSFER_TYPES.includes(
    input.transfer_type
  )
    ? input.transfer_type
    : "one_way";

  if (
    transferType === "return" &&
    (!validDate(input.return_date) || !validTime(input.return_time))
  ) {
    throw new Error(
      "A valid return date and time are required for a return transfer."
    );
  }

  const discountCode = cleanText(input.discount_code, 50);
  const discountAmountEur = 0;
  const totalEur = round2(eur + discountAmountEur);

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
// BOOKING REFERENCE
// ==========================================

function makeBookingReference() {
  return "IT-" +
    new Date().toISOString().slice(2, 10).replace(/-/g, "") +
    "-" +
    crypto.randomBytes(3).toString("hex").toUpperCase();
}

// ==========================================
// BOOKING EMAIL
// ==========================================

async function sendBookingEmail(booking, quote) {
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

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
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
        It is <b>pending payment/confirmation</b>;
        this email is not a paid ticket.
      </p>

      <hr>

      <p><b>Reference:</b> ${escapeHtml(booking.booking_reference)}</p>
      <p><b>Service:</b> ${escapeHtml(booking.service_type || "Private transfer")}</p>
      <p><b>Pickup:</b> ${escapeHtml(booking.pickup_location)}</p>
      <p><b>Drop-off:</b> ${escapeHtml(booking.destination)}</p>
      <p><b>Date/time:</b> ${escapeHtml(dateTime)}</p>
      <p><b>Passengers:</b> ${booking.passengers}</p>
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
    </div>`;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: booking.email,
    subject: `Booking request received — ${booking.booking_reference}`,
    html
  });

  return { sent: true };
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
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
    const err = new Error(
      "Google Maps is not configured. Add GOOGLE_MAPS_API_KEY to the server environment."
    );

    err.status = 503;
    throw err;
  }

  const body = {
    origin: { address: origin },
    destination: { address: destination },
    intermediates: intermediates.map(address => ({
      address
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
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (!response.ok || !data.routes?.[0]) {
    const err = new Error(
      data.error?.message ||
      "Google Maps could not calculate this route."
    );

    err.status = response.status || 502;
    throw err;
  }

  const route = data.routes[0];

  return {
    distanceKm: round2(route.distanceMeters / 1000),
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

  // Approximate Iceland geographic boundaries.
  photonUrl.searchParams.set(
    "bbox",
    "-25.0,63.0,-12.0,67.5"
  );

  let response;

  try {
    response = await fetch(photonUrl, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "ICELAND-TRANSFER-Booking/1.0"
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
      "Place search is temporarily unavailable. Please try again."
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
      const coordinates = feature.geometry?.coordinates || [];

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
        address: [...new Set(addressParts)].join(", "),
        latitude,
        longitude,
        osmId: properties.osm_id || null,
        osmType: properties.osm_type || null
      };
    })
    .filter(place =>
      Number.isFinite(place.latitude) &&
      Number.isFinite(place.longitude)
    );
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

  const phone = cleanText(input.phone, 50);

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
    !destination ||
    !validDate(pickupDate) ||
    !validTime(pickupTime)
  ) {
    throw new Error(
      "Please complete your name, valid email, phone, pickup, drop-off, date and time."
    );
  }

  const pickupAt = parsePickup(
    pickupDate,
    pickupTime
  );

  if (pickupAt.getTime() < Date.now() - 60 * 1000) {
    throw new Error(
      "Pickup date/time must be in the future."
    );
  }

  const quote = calculateQuote(input);

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
      ? input.return_time
      : null;

  const row = {
    booking_reference: bookingReference,
    full_name: fullName,
    email,
    phone,
    pickup_location: pickup,
    destination,
    pickup_date: pickupDate,

    pickup_time: pickupTime.length === 5
      ? `${pickupTime}:00`
      : pickupTime,

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

    return_date: returnDate || null,
    return_time: returnTime || null,
    transfer_type: quote.transferType,

    vehicle_code: quote.vehicle.code,
    vehicle_name: quote.vehicle.name,

    billing_country:
      cleanText(input.billing_country, 100) || null,

    billing_city:
      cleanText(input.billing_city, 120) || null,

    billing_address:
      cleanText(input.billing_address, 250) || null,

    billing_postcode:
      cleanText(input.billing_postcode, 40) || null,

    discount_code: quote.discountCode || null,
    discount_amount: 0,
    confirmation_email_sent_at: null
  };

  const { data, error } = await supabase
    .from("bookings")
    .insert(row)
    .select("*")
    .single();

  // Maximum five active bookings per pickup hour.
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

    throw new Error(
      `Database could not save the booking: ${error.message}`
    );
  }

  const cancellationUrl =
    `${PUBLIC_SERVER_URL}/cancel/${cancellationToken}`;

  let emailResult = { sent: false };

  try {
    emailResult = await sendBookingEmail(data, quote);

    if (emailResult.sent) {
      await supabase
        .from("bookings")
        .update({
          confirmation_email_sent_at:
            new Date().toISOString()
        })
        .eq("id", data.id);
    }

  } catch (e) {
    console.error(
      "Booking email failed:",
      e.message
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
      pickupTime,
      vehicle: quote.vehicle.name,
      passengers: quote.passengers,

      price: {
        currency: "ISK",
        amount: quote.totalIsk,
        eur: quote.totalEur,
        rate: EUR_TO_ISK_RATE
      },

      cancellationUrl
    },

    email: emailResult,

    message:
      "Booking request saved. It is pending payment/confirmation; it is not confirmed as paid."
  };
}

// ==========================================
// CANCEL BOOKING
// ==========================================

async function cancelBooking(token) {
  const cleanToken = cleanText(token, 128);

  if (!/^[a-f0-9]{64}$/i.test(cleanToken)) {
    throw new Error("Invalid cancellation link.");
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("cancellation_token", cleanToken)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!booking) {
    throw new Error("Booking not found.");
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
    throw new Error(
      `Cancellation is available until ${CANCELLATION_HOURS} hours before pickup.`
    );
  }

  const { error: updateError } = await supabase
    .from("bookings")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString()
    })
    .eq("id", booking.id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return {
    cancelled: true,
    bookingId: booking.id,
    message: "Booking cancelled successfully."
  };
}

// ==========================================
// HTTP SERVER AND API ROUTES
// ==========================================

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return json(res, 204, {});
  }

  const url = new URL(
    req.url,
    `http://${req.headers.host || "localhost"}`
  );

  try {

    // HOME
    if (req.method === "GET" && url.pathname === "/") {
      return json(res, 200, {
        name: "ICELAND TRANSFER API",
        status: "running",
        version: "2.0.0"
      });
    }

    // HEALTH CHECK
    if (req.method === "GET" && url.pathname === "/health") {
      const { error } = await supabase
        .from("bookings")
        .select("id", {
          head: true,
          count: "exact"
        });

      return json(res, error ? 503 : 200, {
        ok: !error,
        database: error ? "error" : "connected",
        version: "2.0.0"
      });
    }

    // CATALOG
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

        vehicles: VEHICLES.map(v => ({
          ...v,
          fromIsk: toIsk(v.fromEur),
          fromCurrency: "EUR"
        })),

        routes: ROUTES.map(r => ({
          ...r,

          prices: Object.fromEntries(
            Object.entries(r.prices).map(([k, v]) => [
              k,
              {
                eur: v,
                isk: toIsk(v)
              }
            ])
          )
        })),

        tours: TOURS.map(t => ({
          ...t,

          prices: Object.fromEntries(
            Object.entries(t.prices).map(([k, v]) => [
              k,
              {
                eur: v,
                isk: toIsk(v)
              }
            ])
          )
        })),

        childSeats: CHILD_SEATS,

        policies: {
          cancellationHours: CANCELLATION_HOURS,
          maxBookingsPerHour: MAX_BOOKINGS_PER_HOUR,
          timeZone: "Atlantic/Reykjavik",
          childSeatsFree: true
        }
      });
    }

    // PRICE QUOTE
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

        basePrice: {
          eur: quote.basePriceEur,
          isk: toIsk(quote.basePriceEur)
        },

        total: {
          currency: "ISK",
          isk: quote.totalIsk,
          eur: quote.totalEur
        },

        eurToIskRate: EUR_TO_ISK_RATE,

        note:
          "For unspecified transfer routes, the amount is a fleet starting-price estimate, not a route-confirmed fixed quote."
      });
    }

    // ======================================
    // PLACES SEARCH — PHOTON / OPENSTREETMAP
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

    // GOOGLE MAPS ROUTE
    if (
      req.method === "POST" &&
      url.pathname === "/api/maps/route"
    ) {
      const input = await readBody(req);

      const origin = cleanText(input.origin, 300);
      const destination = cleanText(input.destination, 300);

      if (!origin || !destination) {
        return json(res, 400, {
          error: "Origin and destination are required."
        });
      }

      const result = await googleRoute(
        origin,
        destination,
        Array.isArray(input.waypoints)
          ? input.waypoints.slice(0, 8)
          : []
      );

      return json(res, 200, result);
    }

    // CREATE BOOKING
    if (
      req.method === "POST" &&
      url.pathname === "/api/bookings"
    ) {
      const input = await readBody(req);
      const result = await createBooking(input);

      return json(res, 201, result);
    }

    // CANCEL BOOKING
    if (
      req.method === "POST" &&
      url.pathname === "/api/bookings/cancel"
    ) {
      const input = await readBody(req);

      const result = await cancelBooking(
        input.token || input.cancellation_token
      );

      return json(res, 200, result);
    }

    // CANCEL BOOKING BY TOKEN
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

    // TEYA PAYMENT — NOT ENABLED
    if (
      req.method === "POST" &&
      url.pathname === "/api/payments/teya/create-session"
    ) {
      return json(res, 501, {
        error: "Teya live payments are not enabled yet.",

        reason:
          "Merchant API credentials and the correct Teya integration contract are required. No card details should be collected by this server."
      });
    }

    // UNKNOWN ROUTE
    return json(res, 404, {
      error: "Endpoint not found."
    });

  } catch (error) {
    console.error(error);

    return json(res, error.status || 400, {
      error: error.message || "Unexpected server error."
    });
  }
});

// ==========================================
// START SERVER
// ==========================================

server.listen(PORT, () => {
  console.log(
    `ICELAND TRANSFER API v2 running on port ${PORT}`
  );
});
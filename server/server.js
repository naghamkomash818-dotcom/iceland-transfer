require("dotenv").config();

const http = require("http");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const PORT = Number(process.env.PORT) || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const PUBLIC_SERVER_URL =
    "https://iceland-transfer-server.onrender.com";

const WORK_START_HOUR = 6;
const LAST_TRIP_START_HOUR = 22;
const CANCELLATION_LIMIT_HOURS = 24;
const MAX_REQUEST_SIZE = 100000;

const SERVICE_DURATIONS = {
    transfer: 1,
    golden_circle_tour: 8,
    northern_lights_tour: 5
};

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.error(
        "ERROR: SUPABASE_URL and SUPABASE_SECRET_KEY must be configured."
    );
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

/* =========================================
   HTTP HELPERS
========================================= */

function sendJSON(res, statusCode, data) {
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
    });

    res.end(JSON.stringify(data));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        let size = 0;
        let tooLarge = false;

        req.on("data", chunk => {
            size += chunk.length;

            if (size > MAX_REQUEST_SIZE) {
                tooLarge = true;

                reject(
                    Object.assign(
                        new Error("Request body is too large."),
                        { statusCode: 413 }
                    )
                );

                return;
            }

            body += chunk.toString("utf8");
        });

        req.on("end", () => {
            if (tooLarge) return;

            try {
                const parsed = body ? JSON.parse(body) : {};

                if (
                    !parsed ||
                    typeof parsed !== "object" ||
                    Array.isArray(parsed)
                ) {
                    throw new Error("Invalid request body.");
                }

                resolve(parsed);
            } catch {
                reject(
                    Object.assign(
                        new Error("Invalid JSON request."),
                        { statusCode: 400 }
                    )
                );
            }
        });

        req.on("error", reject);
    });
}

function isValidString(value, maxLength = 250) {
    return (
        typeof value === "string" &&
        value.trim().length > 0 &&
        value.trim().length <= maxLength
    );
}

function normalizeText(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ");
}

function safeNumber(value, defaultValue = 0) {
    const number = Number(value);

    return Number.isFinite(number) ? number : defaultValue;
}

function isValidDate(date) {
    if (
        typeof date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date)
    ) {
        return false;
    }

    const parsed = new Date(`${date}T00:00:00.000Z`);

    return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === date
    );
}

function isValidTime(time) {
    return (
        typeof time === "string" &&
        /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(time)
    );
}

/*
 * Booking dates and times are interpreted as Iceland local time.
 * Iceland uses UTC year-round, so UTC calculations are appropriate.
 */

function getPickupDateTime(date, time) {
    return new Date(`${date}T${time.slice(0, 5)}:00.000Z`);
}

function getDuration(serviceType) {
    return SERVICE_DURATIONS[serviceType] || 1;
}

function getTripEndDateTime(date, time, duration) {
    return new Date(
        getPickupDateTime(date, time).getTime() +
        duration * 60 * 60 * 1000
    );
}

function isValidPassengers(value) {
    return (
        Number.isInteger(Number(value)) &&
        Number(value) >= 1 &&
        Number(value) <= 20
    );
}

function isValidEmail(email) {
    return (
        typeof email === "string" &&
        email.length <= 254 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    );
}

function normalizePackage(value) {
    return normalizeText(value).replace(/\s+/g, "_");
}

/* =========================================
   LOCATION NORMALIZATION
========================================= */

function canonicalLocation(value) {
    const text = normalizeText(value);

    const aliases = {
        "keflavik": "keflavik airport",
        "keflavik airport": "keflavik airport",
        "kef airport": "keflavik airport",
        "reykjavik": "reykjavik",
        "blue lagoon": "blue lagoon",
        "sky lagoon": "sky lagoon",
        "cruise port": "cruise port"
    };

    return aliases[text] || text;
}

/* =========================================
   TRANSFER PRICING — ISK
========================================= */

const TRANSFER_PRICES = {
    "keflavik airport|reykjavik": 20000,
    "reykjavik|keflavik airport": 20000,

    "reykjavik|blue lagoon": 25000,
    "blue lagoon|reykjavik": 25000,

    "keflavik airport|blue lagoon": 12000,
    "blue lagoon|keflavik airport": 12000,

    "reykjavik|golden circle": 45000,
    "golden circle|reykjavik": 45000,

    "reykjavik|sky lagoon": 15000,
    "sky lagoon|reykjavik": 15000,

    "reykjavik|cruise port": 8000,
    "cruise port|reykjavik": 8000
};

function calculateTransferPrice(pickup, destination) {
    const key =
        `${canonicalLocation(pickup)}|${canonicalLocation(destination)}`;

    /*
     * Keep the existing default estimate for locations
     * not explicitly listed in the table.
     */
    return TRANSFER_PRICES[key] || 30000;
}

/* =========================================
   GOLDEN CIRCLE PRICING
========================================= */

const GOLDEN_CIRCLE_PACKAGES = {
    classic: 80400,
    extended: 128900,
    premium: 225000
};

const GOLDEN_CIRCLE_ADDONS = {
    kerid: {
        name: "Kerid Crater",
        pricePerPassenger: 1500
    },

    fridheimar: {
        name: "Fridheimar Tomato Farm",
        pricePerPassenger: 2500
    },

    secret_lagoon: {
        name: "Secret Lagoon",
        pricePerPassenger: 12000
    },

    skalholt: {
        name: "Skalholt",
        pricePerPassenger: 3000,
        perBooking: true
    },

    fontana: {
        name: "Laugarvatn Fontana",
        pricePerPassenger: 8000
    },

    bruarfoss: {
        name: "Bruarfoss Waterfall",
        pricePerPassenger: 5000,
        perBooking: true
    }
};

function calculateGoldenCirclePrice(booking) {
    const packageType = normalizePackage(
        booking.package_type || "classic"
    );

    const basePrice = GOLDEN_CIRCLE_PACKAGES[packageType];

    if (basePrice === undefined) {
        throw new Error("Invalid Golden Circle package.");
    }

    const passengers = Number(booking.passengers);

    if (!isValidPassengers(passengers)) {
        throw new Error("Invalid number of passengers.");
    }

    const selectedAddons = Array.isArray(booking.addons)
        ? booking.addons
        : [];

    let extrasTotal = 0;
    const extras = [];
    const seen = new Set();

    for (const item of selectedAddons) {
        const id = typeof item === "string"
            ? item
            : item && item.id;

        if (
            !id ||
            !GOLDEN_CIRCLE_ADDONS[id] ||
            seen.has(id)
        ) {
            continue;
        }

        seen.add(id);

        const addon = GOLDEN_CIRCLE_ADDONS[id];

        const quantity = addon.perBooking ? 1 : passengers;
        const lineTotal = addon.pricePerPassenger * quantity;

        extrasTotal += lineTotal;

        extras.push({
            id,
            name: addon.name,
            quantity,
            unit_price: addon.pricePerPassenger,
            total: lineTotal
        });
    }

    return {
        package_type: packageType,
        base_price: basePrice,
        extras,
        extras_total: extrasTotal,
        total: basePrice + extrasTotal
    };
}

/* =========================================
   NORTHERN LIGHTS PRICING
========================================= */

const NORTHERN_LIGHTS_PACKAGES = {
    classic: {
        price: 89900,
        capacity: 3,
        name: "Classic"
    },

    comfort: {
        price: 129900,
        capacity: 7,
        name: "Comfort"
    },

    premium: {
        price: 189900,
        capacity: 20,
        name: "Premium"
    }
};

const NORTHERN_LIGHTS_EXTRAS = {
    warm_drinks: {
        name: "Warm Drinks",
        pricePerPassenger: 2500
    },

    photo_stop: {
        name: "Photo Stop",
        pricePerPassenger: 15000,
        perBooking: true
    }
};

function calculateNorthernLightsPrice(booking) {
    const packageType = normalizePackage(
        booking.package_type || "classic"
    );

    const packageInfo = NORTHERN_LIGHTS_PACKAGES[packageType];

    if (!packageInfo) {
        throw new Error("Invalid Northern Lights package.");
    }

    const passengers = Number(booking.passengers);

    if (!isValidPassengers(passengers)) {
        throw new Error("Invalid number of passengers.");
    }

    if (passengers > packageInfo.capacity) {
        throw new Error(
            `The selected package allows a maximum of ${packageInfo.capacity} passengers.`
        );
    }

    const selectedExtras = Array.isArray(booking.extras)
        ? booking.extras
        : [];

    let extrasTotal = 0;
    const extras = [];
    const seen = new Set();

    for (const item of selectedExtras) {
        const id = typeof item === "string"
            ? item
            : item && item.id;

        if (
            !id ||
            !NORTHERN_LIGHTS_EXTRAS[id] ||
            seen.has(id)
        ) {
            continue;
        }

        seen.add(id);

        const extra = NORTHERN_LIGHTS_EXTRAS[id];

        const quantity = extra.perBooking ? 1 : passengers;
        const lineTotal = extra.pricePerPassenger * quantity;

        extrasTotal += lineTotal;

        extras.push({
            id,
            name: extra.name,
            quantity,
            unit_price: extra.pricePerPassenger,
            total: lineTotal
        });
    }

    return {
        package_type: packageType,
        package_name: packageInfo.name,
        base_price: packageInfo.price,
        extras,
        extras_total: extrasTotal,
        total: packageInfo.price + extrasTotal
    };
}

/* =========================================
   SERVICE TYPE
========================================= */

function normalizeServiceType(value, booking = {}) {
    const raw = normalizeText(value);

    const name = normalizeText(
        booking.name ||
        booking.service_name ||
        booking.service ||
        ""
    );

    if (
        raw.includes("northern") ||
        raw.includes("aurora") ||
        name.includes("northern lights") ||
        name.includes("aurora")
    ) {
        return "northern_lights_tour";
    }

    if (
        raw.includes("golden") ||
        name.includes("golden circle")
    ) {
        return "golden_circle_tour";
    }

    return "transfer";
}

function calculateBookingPrice(booking) {
    const serviceType = normalizeServiceType(
        booking.service_type,
        booking
    );

    if (serviceType === "golden_circle_tour") {
        return {
            service_type: serviceType,
            ...calculateGoldenCirclePrice(booking)
        };
    }

    if (serviceType === "northern_lights_tour") {
        return {
            service_type: serviceType,
            ...calculateNorthernLightsPrice(booking)
        };
    }

    const price = calculateTransferPrice(
        booking.pickup_location,
        booking.destination
    );

    return {
        service_type: "transfer",
        package_type: null,
        base_price: price,
        extras: [],
        extras_total: 0,
        total: price
    };
}

/* =========================================
   VALIDATION
========================================= */

function validateBooking(booking) {
    const errors = [];

    const fullName =
        booking.full_name ||
        booking.customerName ||
        booking.customer_name;

    if (!isValidString(fullName, 150)) {
        errors.push("Please enter your full name.");
    }

    if (!isValidEmail(booking.email)) {
        errors.push("Please enter a valid email address.");
    }

    if (!isValidString(booking.phone, 40)) {
        errors.push("Please enter a valid phone number.");
    }

    if (!isValidString(booking.pickup_location, 250)) {
        errors.push("Please select a pickup location.");
    }

    if (!isValidString(booking.destination, 250)) {
        errors.push("Please select a destination.");
    }

    if (
        isValidString(booking.pickup_location, 250) &&
        isValidString(booking.destination, 250) &&
        canonicalLocation(booking.pickup_location) ===
        canonicalLocation(booking.destination)
    ) {
        errors.push("Pickup and destination must be different.");
    }

    if (!isValidDate(booking.pickup_date)) {
        errors.push("Please select a valid travel date.");
    }

    if (!isValidTime(booking.pickup_time)) {
        errors.push("Please select a valid travel time.");
    }

    if (!isValidPassengers(booking.passengers)) {
        errors.push(
            "The number of passengers must be between 1 and 20."
        );
    }

    if (
        booking.luggage !== undefined &&
        (
            !Number.isInteger(Number(booking.luggage)) ||
            Number(booking.luggage) < 0 ||
            Number(booking.luggage) > 100
        )
    ) {
        errors.push("Please enter a valid luggage quantity.");
    }

    if (
        booking.special_requests !== undefined &&
        (
            typeof booking.special_requests !== "string" ||
            booking.special_requests.length > 2000
        )
    ) {
        errors.push("Special requests are too long.");
    }

    if (errors.length > 0) {
        return errors;
    }

    const start = getPickupDateTime(
        booking.pickup_date,
        booking.pickup_time
    );

    if (start.getTime() <= Date.now()) {
        errors.push("The selected travel time must be in the future.");
    }

    const hour = Number(booking.pickup_time.slice(0, 2));

    if (
        hour < WORK_START_HOUR ||
        hour > LAST_TRIP_START_HOUR
    ) {
        errors.push(
            "Available departure times are between 06:00 and 22:00."
        );
    }

    return errors;
}

/* =========================================
   AVAILABILITY CHECK
========================================= */

async function checkSlotAvailable(
    date,
    time,
    duration,
    excludeBookingId = null
) {
    const requestedStart = getPickupDateTime(date, time);

    const requestedEnd = new Date(
        requestedStart.getTime() +
        duration * 60 * 60 * 1000
    );

    const dayStart = new Date(`${date}T00:00:00.000Z`);

    const previousDay = new Date(
        dayStart.getTime() - 24 * 60 * 60 * 1000
    );

    const nextDay = new Date(
        dayStart.getTime() + 24 * 60 * 60 * 1000
    );

    const searchStart = previousDay.toISOString().slice(0, 10);
    const searchEnd = nextDay.toISOString().slice(0, 10);

    let query = supabase
        .from("bookings")
        .select(
            "id,pickup_date,pickup_time,trip_end_time,service_duration_hours,status"
        )
        .gte("pickup_date", searchStart)
        .lte("pickup_date", searchEnd)
        .neq("status", "cancelled");

    if (excludeBookingId) {
        query = query.neq("id", excludeBookingId);
    }

    const { data, error } = await query;

    if (error) {
        console.error("Availability database error:", error.message);

        throw new Error(
            "Unable to check availability. Please try again later."
        );
    }

    for (const existing of data || []) {
        if (!existing.pickup_date || !existing.pickup_time) {
            continue;
        }

        const existingStart = getPickupDateTime(
            existing.pickup_date,
            existing.pickup_time
        );

        let existingEnd;

        if (existing.trip_end_time) {
            existingEnd = new Date(existing.trip_end_time);
        } else {
            const oldDuration = safeNumber(
                existing.service_duration_hours,
                1
            );

            existingEnd = new Date(
                existingStart.getTime() +
                oldDuration * 60 * 60 * 1000
            );
        }

        if (
            requestedStart < existingEnd &&
            requestedEnd > existingStart
        ) {
            return false;
        }
    }

    return true;
}

/* =========================================
   CREATE BOOKING
========================================= */

async function createBooking(booking) {
    const errors = validateBooking(booking);

    if (errors.length > 0) {
        return {
            status: 400,
            body: {
                success: false,
                errors
            }
        };
    }

    const serviceType = normalizeServiceType(
        booking.service_type,
        booking
    );

    const duration = getDuration(serviceType);
    const passengers = Number(booking.passengers);

    let pricing;

    try {
        pricing = calculateBookingPrice({
            ...booking,
            service_type: serviceType,
            passengers
        });
    } catch (error) {
        return {
            status: 400,
            body: {
                success: false,
                error: error.message
            }
        };
    }

    let available;

    try {
        available = await checkSlotAvailable(
            booking.pickup_date,
            booking.pickup_time,
            duration
        );
    } catch (error) {
        return {
            status: 503,
            body: {
                success: false,
                error: error.message
            }
        };
    }

    if (!available) {
        return {
            status: 409,
            body: {
                success: false,
                error:
                    "This time slot is already booked. Please select another time."
            }
        };
    }

    const cancellationToken = crypto
        .randomBytes(32)
        .toString("hex");

    const tripEnd = getTripEndDateTime(
        booking.pickup_date,
        booking.pickup_time,
        duration
    );

    const storedAddons = pricing.extras.map(extra => ({
        id: extra.id,
        name: extra.name,
        quantity: extra.quantity,
        unit_price: extra.unit_price,
        total: extra.total
    }));

    const selectedStops = Array.isArray(booking.selected_stops)
        ? booking.selected_stops
            .filter(item => typeof item === "string")
            .map(item => item.trim())
            .filter(Boolean)
            .slice(0, 30)
        : [];

    const insertData = {
        full_name: String(
            booking.full_name ||
            booking.customerName ||
            booking.customer_name
        ).trim(),

        email: String(booking.email).trim(),

        phone: String(booking.phone).trim(),

        pickup_location: String(booking.pickup_location).trim(),

        destination: String(booking.destination).trim(),

        pickup_date: booking.pickup_date,

        pickup_time: booking.pickup_time.slice(0, 5),

        passengers,

        luggage: safeNumber(booking.luggage, 0),

        flight_number: String(
            booking.flight_number || ""
        ).trim(),

        special_requests: String(
            booking.special_requests ||
            booking.notes ||
            ""
        ).trim(),

        price: pricing.total,

        status: "confirmed",

        cancellation_token: cancellationToken,

        cancelled_at: null,

        service_type: serviceType,

        package_type: pricing.package_type || null,

        addons: storedAddons,

        extras_total: pricing.extras_total,

        trip_end_time: tripEnd.toISOString(),

        service_duration_hours: duration,

        selected_stops: selectedStops
    };

    const { data, error } = await supabase
        .from("bookings")
        .insert(insertData)
        .select("*")
        .single();

    if (error) {
        console.error("Booking insert failed:", error.message);

        return {
            status: 500,
            body: {
                success: false,
                error:
                    "The booking could not be saved. Please try again later."
            }
        };
    }

    const invoice = {
        invoice_number: data.id,
        booking_id: data.id,

        customer_name: data.full_name,
        email: data.email,
        phone: data.phone,

        pickup_location: data.pickup_location,
        destination: data.destination,

        pickup_date: data.pickup_date,
        pickup_time: data.pickup_time,

        passengers: data.passengers,
        luggage: data.luggage,

        service_type: data.service_type,
        package_type: data.package_type,

        base_price: pricing.base_price,
        extras: pricing.extras,
        extras_total: pricing.extras_total,
        total: pricing.total,

        currency: "ISK",
        status: data.status,
        created_at: data.created_at
    };

    return {
        status: 201,
        body: {
            success: true,
            message: "Booking confirmed successfully.",
            booking: data,
            invoice,

            cancellation_url:
                `${PUBLIC_SERVER_URL}/api/bookings/cancel/${cancellationToken}`,

            cancellation_policy:
                "Bookings can be cancelled more than 24 hours before departure. Cancellations are not allowed within 24 hours of departure."
        }
    };
}

/* =========================================
   CANCEL BOOKING
========================================= */

async function cancelBooking(token) {
    if (!/^[a-f0-9]{64}$/i.test(token)) {
        return {
            status: 400,
            body: {
                success: false,
                error: "Invalid cancellation token."
            }
        };
    }

    const { data: booking, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("cancellation_token", token)
        .maybeSingle();

    if (error) {
        console.error("Cancellation lookup failed:", error.message);

        return {
            status: 500,
            body: {
                success: false,
                error: "Unable to process cancellation."
            }
        };
    }

    if (!booking) {
        return {
            status: 404,
            body: {
                success: false,
                error: "Booking not found."
            }
        };
    }

    if (booking.status === "cancelled") {
        return {
            status: 200,
            body: {
                success: true,
                message: "This booking has already been cancelled."
            }
        };
    }

    if (booking.status !== "confirmed") {
        return {
            status: 409,
            body: {
                success: false,
                error: "This booking cannot be cancelled in its current status."
            }
        };
    }

    const departure = getPickupDateTime(
        booking.pickup_date,
        booking.pickup_time
    );

    const remainingTime = departure.getTime() - Date.now();

    const requiredTime =
        CANCELLATION_LIMIT_HOURS * 60 * 60 * 1000;

    if (remainingTime <= requiredTime) {
        return {
            status: 403,
            body: {
                success: false,
                error:
                    "Cancellation is not allowed within 24 hours of departure."
            }
        };
    }

    const { data: updated, error: updateError } = await supabase
        .from("bookings")
        .update({
            status: "cancelled",
            cancelled_at: new Date().toISOString()
        })
        .eq("id", booking.id)
        .eq("status", "confirmed")
        .select("*")
        .maybeSingle();

    if (updateError) {
        console.error(
            "Cancellation update failed:",
            updateError.message
        );

        return {
            status: 500,
            body: {
                success: false,
                error: "Unable to cancel this booking."
            }
        };
    }

    if (!updated) {
        return {
            status: 409,
            body: {
                success: false,
                error:
                    "The booking status changed. Please refresh and try again."
            }
        };
    }

    return {
        status: 200,
        body: {
            success: true,
            message: "Your booking has been cancelled.",
            booking: updated
        }
    };
}

/* =========================================
   AVAILABILITY API
========================================= */

async function getAvailability(url, res) {
    const date = url.searchParams.get("date");

    if (!isValidDate(date)) {
        return sendJSON(res, 400, {
            success: false,
            error: "A valid date is required."
        });
    }

    const serviceType = normalizeServiceType(
        url.searchParams.get("service_type")
    );

    const duration = getDuration(serviceType);
    const availableTimes = [];

    for (
        let hour = WORK_START_HOUR;
        hour <= LAST_TRIP_START_HOUR;
        hour++
    ) {
        const time = `${String(hour).padStart(2, "0")}:00`;

        const departure = getPickupDateTime(date, time);

        if (departure.getTime() <= Date.now()) {
            continue;
        }

        try {
            const available = await checkSlotAvailable(
                date,
                time,
                duration
            );

            availableTimes.push({
                time,
                available
            });
        } catch (error) {
            console.error(
                "Availability check failed:",
                error.message
            );

            return sendJSON(res, 503, {
                success: false,
                error: "Unable to check availability."
            });
        }
    }

    return sendJSON(res, 200, {
        success: true,
        date,
        service_type: serviceType,
        available_times: availableTimes
    });
}

/* =========================================
   HTTP SERVER
========================================= */

const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Max-Age": "86400"
        });

        return res.end();
    }

    let url;

    try {
        url = new URL(
            req.url,
            `http://${req.headers.host || "localhost"}`
        );
    } catch {
        return sendJSON(res, 400, {
            success: false,
            error: "Invalid request URL."
        });
    }

    const pathname = url.pathname;

    /* Health check */

    if (
        req.method === "GET" &&
        (pathname === "/" || pathname === "/health")
    ) {
        return sendJSON(res, 200, {
            success: true,
            message: "Iceland Transfer server is running.",
            timestamp: new Date().toISOString()
        });
    }

    /* Availability */

    if (
        req.method === "GET" &&
        pathname === "/api/availability"
    ) {
        return getAvailability(url, res);
    }

    /* Create booking */

    if (
        req.method === "POST" &&
        pathname === "/api/bookings"
    ) {
        try {
            const body = await readBody(req);
            const result = await createBooking(body);

            return sendJSON(
                res,
                result.status,
                result.body
            );
        } catch (error) {
            console.error(
                "Booking request error:",
                error.message
            );

            return sendJSON(
                res,
                error.statusCode || 500,
                {
                    success: false,
                    error:
                        error.statusCode === 413
                            ? "Request body is too large."
                            : error.statusCode === 400
                                ? "Invalid request data."
                                : "An unexpected server error occurred."
                }
            );
        }
    }

    /* Cancel booking */

    const cancelMatch = pathname.match(
        /^\/api\/bookings\/cancel\/([a-f0-9]{64})$/i
    );

    if (
        req.method === "POST" &&
        cancelMatch
    ) {
        try {
            const result = await cancelBooking(
                cancelMatch[1]
            );

            return sendJSON(
                res,
                result.status,
                result.body
            );
        } catch (error) {
            console.error(
                "Cancellation request error:",
                error.message
            );

            return sendJSON(res, 500, {
                success: false,
                error: "An unexpected server error occurred."
            });
        }
    }

    /* Unknown endpoint */

    return sendJSON(res, 404, {
        success: false,
        error: "Endpoint not found."
    });
});

server.listen(PORT, () => {
    console.log(
        `Iceland Transfer server running on port ${PORT}`
    );
});
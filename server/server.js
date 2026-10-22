require("dotenv").config();

const http = require("http");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const PORT = Number(process.env.PORT) || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const PUBLIC_SERVER_URL =
    "https://iceland-transfer-server.onrender.com";

const CURRENCY = "ISK";
const WORK_START_HOUR = 6;
const LAST_TRIP_START_HOUR = 22;

const TRANSFER_DURATION_HOURS = 1;
const GOLDEN_CIRCLE_DURATION_HOURS = 8;
const NORTHERN_LIGHTS_DURATION_HOURS = 5;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.error("ERROR: Supabase environment variables are missing.");
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

const ALLOWED_ORIGINS = (
    process.env.ALLOWED_ORIGINS || ""
)
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

const ROUTE_PRICES = {
    "keflavik airport|reykjavik": 20000,
    "reykjavik|keflavik airport": 20000,
    "reykjavik|blue lagoon": 25000,
    "keflavik airport|blue lagoon": 12000,
    "reykjavik|golden circle": 45000,
    "reykjavik|sky lagoon": 15000,
    "reykjavik|cruise port": 8000
};

const DEFAULT_ROUTE_PRICE = 30000;

const GOLDEN_CIRCLE_PACKAGES = {
    classic: {
        name: "Classic",
        price: 80400
    },
    extended: {
        name: "Extended",
        price: 128900
    },
    premium: {
        name: "Premium",
        price: 225000
    }
};

const GOLDEN_CIRCLE_STOPS = {
    thingvellir: {
        name: "Þingvellir National Park",
        price: 0,
        pricing: "included"
    },
    geysir: {
        name: "Geysir Geothermal Area",
        price: 0,
        pricing: "included"
    },
    gullfoss: {
        name: "Gullfoss Waterfall",
        price: 0,
        pricing: "included"
    },
    kerid: {
        name: "Kerið Crater",
        price: 1500,
        pricing: "per_passenger"
    },
    fridheimar: {
        name: "Friðheimar Greenhouse",
        price: 2500,
        pricing: "per_passenger"
    },
    secret_lagoon: {
        name: "Secret Lagoon",
        price: 12000,
        pricing: "per_passenger"
    },
    skalholt: {
        name: "Skálholt Cathedral",
        price: 3000,
        pricing: "per_group"
    },
    fontana: {
        name: "Laugarvatn Fontana",
        price: 8000,
        pricing: "per_passenger"
    },
    bruarfoss: {
        name: "Brúarfoss Waterfall",
        price: 5000,
        pricing: "per_group"
    }
};

const GOLDEN_CIRCLE_ADDONS = {
    kerid: {
        name: "Kerið Crater",
        price_per_passenger: 1500
    },
    fridheimar: {
        name: "Friðheimar",
        price_per_passenger: 2500
    },
    secret_lagoon: {
        name: "Secret Lagoon",
        price_per_passenger: 12000
    }
};

const NORTHERN_LIGHTS_PACKAGES = {
    classic: {
        name: "Classic Aurora Chase",
        price: 89900,
        capacity: 3
    },
    comfort: {
        name: "Comfort Private Tour",
        price: 129900,
        capacity: 7
    },
    premium: {
        name: "Premium Group Tour",
        price: 189900,
        capacity: 20
    }
};

const NORTHERN_LIGHTS_EXTRAS = {
    warm_drinks: {
        name: "Warm Drinks",
        price: 2500,
        pricing: "per_passenger"
    },
    photo_stop: {
        name: "Photo Stop",
        price: 15000,
        pricing: "per_booking"
    }
};

const rateLimits = new Map();

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;

function sendJSON(res, statusCode, data) {
    if (res.writableEnded) return;

    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY"
    });

    res.end(JSON.stringify(data));
}

function normalizeLocation(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function canonicalLocation(value) {
    const location = normalizeLocation(value);

    const aliases = {
        "keflavik international airport (kef)": "keflavik airport",
        "keflavik international airport": "keflavik airport",
        "keflavik airport (kef)": "keflavik airport",
        "reykjavik city centre": "reykjavik",
        "reykjavik city center": "reykjavik",
        "reykjavík": "reykjavik",
        "reykjavík city centre": "reykjavik",
        "reykjavik harbour / old harbour": "cruise port",
        "reykjavik harbor / old harbor": "cruise port"
    };

    return aliases[location] || location;
}

function validDate(value) {
    if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
        return false;
    }

    const date = new Date(`${value}T00:00:00Z`);

    return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
    );
}

function normalizeTime(value) {
    if (typeof value !== "string") return null;

    const match = value.trim().match(
        /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/
    );

    if (
        !match ||
        match[2] !== "00" ||
        (match[3] && match[3] !== "00")
    ) {
        return null;
    }

    return `${match[1]}:00:00`;
}

function getIcelandDateTime() {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Atlantic/Reykjavik",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    }).formatToParts(new Date());

    const result = {};

    for (const part of parts) {
        if (part.type !== "literal") {
            result[part.type] = part.value;
        }
    }

    return {
        date: `${result.year}-${result.month}-${result.day}`,
        hour: Number(result.hour),
        minute: Number(result.minute),
        second: Number(result.second)
    };
}

function isWithinWorkingHours(time) {
    const hour = Number(time.slice(0, 2));

    return (
        hour >= WORK_START_HOUR &&
        hour <= LAST_TRIP_START_HOUR
    );
}

function isFutureBooking(date, time) {
    const now = getIcelandDateTime();

    if (date > now.date) return true;
    if (date < now.date) return false;

    const currentSeconds =
        now.hour * 3600 +
        now.minute * 60 +
        now.second;

    const requestedSeconds =
        Number(time.slice(0, 2)) * 3600;

    return requestedSeconds > currentSeconds;
}

function toIcelandUTCDate(date, time) {
    return new Date(`${date}T${time.slice(0, 5)}:00Z`);
}

function getDurationHours(serviceType) {
    if (serviceType === "golden_circle_tour") {
        return GOLDEN_CIRCLE_DURATION_HOURS;
    }

    if (serviceType === "northern_lights_tour") {
        return NORTHERN_LIGHTS_DURATION_HOURS;
    }

    return TRANSFER_DURATION_HOURS;
}

function getRoutePrice(pickup, destination) {
    const key =
        `${canonicalLocation(pickup)}|${canonicalLocation(destination)}`;

    return ROUTE_PRICES[key] ?? DEFAULT_ROUTE_PRICE;
}

function validString(value, maxLength) {
    return (
        typeof value === "string" &&
        value.trim().length > 0 &&
        value.trim().length <= maxLength
    );
}

function makeCancellationToken() {
    return crypto.randomBytes(32).toString("hex");
}

function getClientKey(req) {
    return req.socket.remoteAddress || "unknown";
}

function checkRateLimit(req) {
    const key = getClientKey(req);
    const now = Date.now();
    const existing = rateLimits.get(key);

    if (
        !existing ||
        now - existing.start >= RATE_LIMIT_WINDOW_MS
    ) {
        rateLimits.set(key, {
            start: now,
            count: 1
        });

        return true;
    }

    existing.count += 1;

    return existing.count <= RATE_LIMIT_MAX_REQUESTS;
}

function getRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        let tooLarge = false;

        req.on("data", chunk => {
            body += chunk.toString("utf8");

            if (Buffer.byteLength(body, "utf8") > 20000) {
                tooLarge = true;
            }
        });

        req.on("end", () => {
            if (tooLarge) {
                reject(new Error("REQUEST_TOO_LARGE"));
                return;
            }

            try {
                resolve(JSON.parse(body));
            } catch {
                reject(new Error("INVALID_JSON"));
            }
        });

        req.on("error", () => {
            reject(new Error("REQUEST_READ_ERROR"));
        });
    });
}

function checkOrigin(req, res) {
    const origin = req.headers.origin;

    if (!origin) return true;

    if (ALLOWED_ORIGINS.length === 0) {
        // Configure ALLOWED_ORIGINS in Render for production.
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");

        return true;
    }

    if (!ALLOWED_ORIGINS.includes(origin)) {
        sendJSON(res, 403, {
            success: false,
            message: "This website is not allowed to access the booking service."
        });

        return false;
    }

    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");

    return true;
}

// --------------------------------------------------
// GOLDEN CIRCLE PRICING
// --------------------------------------------------

function calculateGoldenCirclePrice(booking) {
    const packageType = String(
        booking.package_type || ""
    ).trim().toLowerCase();

    const selectedPackage =
        GOLDEN_CIRCLE_PACKAGES[packageType];

    if (!selectedPackage) {
        throw new Error(
            "Please select a valid Golden Circle package."
        );
    }

    const passengers = Number(booking.passengers ?? 1);

    if (
        !Number.isInteger(passengers) ||
        passengers < 1 ||
        passengers > 20
    ) {
        throw new Error(
            "Golden Circle tours allow between 1 and 20 passengers."
        );
    }

    const requestedAddons = booking.addons ?? [];

    if (
        !Array.isArray(requestedAddons) ||
        requestedAddons.length > 3 ||
        requestedAddons.some(id => typeof id !== "string")
    ) {
        throw new Error("Invalid Golden Circle add-ons.");
    }

    const uniqueAddonIds = [...new Set(requestedAddons)];

    for (const id of uniqueAddonIds) {
        if (!GOLDEN_CIRCLE_ADDONS[id]) {
            throw new Error(
                "An invalid Golden Circle add-on was selected."
            );
        }
    }

    const requestedStops = booking.selected_stops ?? [];

    if (
        !Array.isArray(requestedStops) ||
        requestedStops.length > 20 ||
        requestedStops.some(id => typeof id !== "string")
    ) {
        throw new Error("Invalid Golden Circle locations.");
    }

    const uniqueStopIds = [...new Set(requestedStops)];

    for (const id of uniqueStopIds) {
        if (id !== "other" && !GOLDEN_CIRCLE_STOPS[id]) {
            throw new Error(
                "An invalid Golden Circle location was selected."
            );
        }
    }

    const otherStop = String(
        booking.other_stop || ""
    ).trim();

    if (otherStop.length > 200) {
        throw new Error("The custom location name is too long.");
    }

    if (uniqueStopIds.includes("other") && !otherStop) {
        throw new Error(
            "Please enter the name of the additional location."
        );
    }

    if (!uniqueStopIds.includes("other") && otherStop) {
        throw new Error(
            "Please select Other before entering a custom location."
        );
    }

    const chargeableStopIds = new Set([
        ...uniqueAddonIds,
        ...uniqueStopIds.filter(id => id !== "other")
    ]);

    const pricedStops = [];
    let extrasTotal = 0;

    for (const id of chargeableStopIds) {
        const stop = GOLDEN_CIRCLE_STOPS[id];

        if (!stop) continue;

        let total = 0;

        if (stop.pricing === "per_passenger") {
            total = stop.price * passengers;
        } else if (stop.pricing === "per_group") {
            total = stop.price;
        }

        extrasTotal += total;

        pricedStops.push({
            id,
            name: stop.name,
            unit_price: stop.price,
            pricing: stop.pricing,
            total
        });
    }

    const selectedStops = uniqueStopIds.map(id => {
        if (id === "other") {
            return {
                id: "other",
                name: otherStop,
                pricing: "price_to_be_confirmed",
                total: null
            };
        }

        const stop = GOLDEN_CIRCLE_STOPS[id];

        return {
            id,
            name: stop.name,
            pricing: stop.pricing,
            unit_price: stop.price
        };
    });

    const addonDetails = pricedStops.filter(stop =>
        ["kerid", "fridheimar", "secret_lagoon"].includes(stop.id)
    );

    return {
        package_type: packageType,
        package_name: selectedPackage.name,
        base_price: selectedPackage.price,
        addons: addonDetails,
        selected_stops: selectedStops,
        priced_stops: pricedStops,
        extras_total: extrasTotal,
        total: selectedPackage.price + extrasTotal,
        custom_stop_requires_confirmation:
            uniqueStopIds.includes("other")
    };
}

// --------------------------------------------------
// NORTHERN LIGHTS PRICING
// --------------------------------------------------

function calculateNorthernLightsPrice(booking) {
    const packageType = String(
        booking.package_type || ""
    ).trim().toLowerCase();

    const selectedPackage =
        NORTHERN_LIGHTS_PACKAGES[packageType];

    if (!selectedPackage) {
        throw new Error(
            "Please select a valid Northern Lights package."
        );
    }

    const passengers = Number(booking.passengers ?? 1);

    if (
        !Number.isInteger(passengers) ||
        passengers < 1 ||
        passengers > selectedPackage.capacity
    ) {
        throw new Error(
            `This package allows between 1 and ${selectedPackage.capacity} passengers.`
        );
    }

    const requestedExtras = booking.extras ?? [];

    if (
        !Array.isArray(requestedExtras) ||
        requestedExtras.length > 2
    ) {
        throw new Error("Invalid Northern Lights extras.");
    }

    const extras = [];
    const seen = new Set();
    let extrasTotal = 0;

    for (const item of requestedExtras) {
        if (!item || typeof item !== "object") {
            throw new Error("Invalid Northern Lights extra.");
        }

        const id = String(item.id || "");

        if (
            !NORTHERN_LIGHTS_EXTRAS[id] ||
            seen.has(id)
        ) {
            throw new Error("An invalid extra was selected.");
        }

        seen.add(id);

        const extra = NORTHERN_LIGHTS_EXTRAS[id];

        const quantity = extra.pricing === "per_passenger"
            ? passengers
            : 1;

        const total = extra.price * quantity;

        extrasTotal += total;

        extras.push({
            id,
            name: extra.name,
            unit_price: extra.price,
            pricing: extra.pricing,
            quantity,
            total
        });
    }

    return {
        package_type: packageType,
        package_name: selectedPackage.name,
        base_price: selectedPackage.price,
        capacity: selectedPackage.capacity,
        extras,
        extras_total: extrasTotal,
        total: selectedPackage.price + extrasTotal
    };
}

// --------------------------------------------------
// CANCELLATION
// --------------------------------------------------

function isMoreThan24HoursAway(date, time) {
    const timestamp =
        toIcelandUTCDate(date, time).getTime();

    return (
        Number.isFinite(timestamp) &&
        timestamp - Date.now() > 24 * 60 * 60 * 1000
    );
}

// --------------------------------------------------
// AVAILABILITY AND OVERLAP CHECKING
// --------------------------------------------------

async function getActiveBookingsForDate(date) {
    const { data, error } = await supabase
        .from("bookings")
        .select(
            "id, pickup_date, pickup_time, service_type, status, trip_end_time, service_duration_hours"
        )
        .eq("pickup_date", date)
        .neq("status", "cancelled");

    if (error) throw error;

    return data || [];
}

function getBookingInterval(row) {
    const time = normalizeTime(
        String(row.pickup_time || "").slice(0, 8)
    );

    if (!time) return null;

    const start = toIcelandUTCDate(
        row.pickup_date,
        time
    ).getTime();

    let duration = Number(row.service_duration_hours);

    if (
        !Number.isInteger(duration) ||
        duration < 1 ||
        duration > 24
    ) {
        duration = getDurationHours(
            row.service_type || "transfer"
        );
    }

    let end;

    if (row.trip_end_time) {
        const parsedEnd = new Date(
            row.trip_end_time
        ).getTime();

        end = Number.isFinite(parsedEnd)
            ? parsedEnd
            : start + duration * 3600000;
    } else {
        end = start + duration * 3600000;
    }

    return { start, end };
}

function hasOverlap(start, end, bookings) {
    return bookings.some(row => {
        const interval = getBookingInterval(row);

        if (!interval) return false;

        return (
            start < interval.end &&
            interval.start < end
        );
    });
}

async function checkSlotAvailable(date, time, serviceType) {
    const dateObj = new Date(`${date}T00:00:00Z`);

    const previousDate = new Date(
        dateObj.getTime() - 86400000
    ).toISOString().slice(0, 10);

    const nextDate = new Date(
        dateObj.getTime() + 86400000
    ).toISOString().slice(0, 10);

    const [previous, same, next] = await Promise.all([
        getActiveBookingsForDate(previousDate),
        getActiveBookingsForDate(date),
        getActiveBookingsForDate(nextDate)
    ]);

    const allBookings = [
        ...previous,
        ...same,
        ...next
    ];

    const start = toIcelandUTCDate(date, time).getTime();
    const duration = getDurationHours(serviceType);
    const end = start + duration * 3600000;

    return !hasOverlap(start, end, allBookings);
}

// --------------------------------------------------
// HTTP SERVER
// --------------------------------------------------

const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");

    if (req.method === "OPTIONS") {
        if (!checkOrigin(req, res)) return;

        res.setHeader(
            "Access-Control-Allow-Methods",
            "GET, POST, OPTIONS"
        );

        res.setHeader(
            "Access-Control-Allow-Headers",
            "Content-Type"
        );

        res.setHeader("Access-Control-Max-Age", "86400");

        res.writeHead(204);
        res.end();

        return;
    }

    if (!checkOrigin(req, res)) return;

    let requestURL;

    try {
        requestURL = new URL(
            req.url,
            `http://${req.headers.host || "localhost"}`
        );
    } catch {
        return sendJSON(res, 400, {
            success: false,
            message: "Invalid request URL."
        });
    }

    const pathname = requestURL.pathname;

    // HEALTH CHECK

    if (req.method === "GET" && pathname === "/health") {
        return sendJSON(res, 200, {
            success: true,
            message: "Iceland Transfer server is running."
        });
    }

    // AVAILABILITY

    if (
        req.method === "GET" &&
        pathname === "/api/availability"
    ) {
        try {
            const date = requestURL.searchParams.get("date");

            if (!validDate(date)) {
                return sendJSON(res, 400, {
                    success: false,
                    message: "Please provide a valid date."
                });
            }

            const now = getIcelandDateTime();

            if (date < now.date) {
                return sendJSON(res, 200, {
                    success: true,
                    date,
                    currency: CURRENCY,
                    available_times: [],
                    booked_times: []
                });
            }

            const bookings =
                await getActiveBookingsForDate(date);

            const bookedTimes = [
                ...new Set(
                    bookings
                        .map(row =>
                            normalizeTime(
                                String(row.pickup_time || "").slice(0, 8)
                            )
                        )
                        .filter(Boolean)
                        .map(time => time.slice(0, 5))
                )
            ];

            const availableTimes = [];

            for (
                let hour = WORK_START_HOUR;
                hour <= LAST_TRIP_START_HOUR;
                hour++
            ) {
                const time =
                    `${String(hour).padStart(2, "0")}:00`;

                const normalized = `${time}:00`;

                if (date === now.date) {
                    const requestedSeconds = hour * 3600;

                    const currentSeconds =
                        now.hour * 3600 +
                        now.minute * 60 +
                        now.second;

                    if (requestedSeconds <= currentSeconds) {
                        continue;
                    }
                }

                // Use the selected service's duration.
                const serviceType =
                    requestURL.searchParams.get("service_type") ||
                    "transfer";

                if (
                    ![
                        "transfer",
                        "golden_circle_tour",
                        "northern_lights_tour"
                    ].includes(serviceType)
                ) {
                    return sendJSON(res, 400, {
                        success: false,
                        message: "Invalid service type."
                    });
                }

                const available = await checkSlotAvailable(
                    date,
                    normalized,
                    serviceType
                );

                if (available) {
                    availableTimes.push(time);
                }
            }

            return sendJSON(res, 200, {
                success: true,
                date,
                currency: CURRENCY,
                available_times: availableTimes,
                booked_times: bookedTimes
            });

        } catch (error) {
            console.error(
                "Availability error:",
                error.message
            );

            return sendJSON(res, 500, {
                success: false,
                message: "Could not load available times."
            });
        }
    }

    // CREATE BOOKING

    if (
        req.method === "POST" &&
        pathname === "/api/bookings"
    ) {
        if (!checkRateLimit(req)) {
            return sendJSON(res, 429, {
                success: false,
                message: "Too many requests. Please wait a minute and try again."
            });
        }

        let booking;

        try {
            booking = await getRequestBody(req);
        } catch (error) {
            return sendJSON(
                res,
                error.message === "REQUEST_TOO_LARGE" ? 413 : 400,
                {
                    success: false,
                    message: "Invalid booking request."
                }
            );
        }

        try {
            if (
                !booking ||
                typeof booking !== "object" ||
                Array.isArray(booking)
            ) {
                return sendJSON(res, 400, {
                    success: false,
                    message: "Invalid booking details."
                });
            }

            const required = [
                "full_name",
                "email",
                "phone",
                "pickup_location",
                "destination",
                "pickup_date",
                "pickup_time"
            ];

            for (const field of required) {
                if (!validString(booking[field], 500)) {
                    return sendJSON(res, 400, {
                        success: false,
                        message: `Missing or invalid field: ${field}`
                    });
                }
            }

            const fullName = booking.full_name.trim();
            const email = booking.email.trim().toLowerCase();
            const phone = booking.phone.trim();
            const pickup = booking.pickup_location.trim();
            const destination = booking.destination.trim();

            if (
                fullName.length > 150 ||
                phone.length > 40
            ) {
                return sendJSON(res, 400, {
                    success: false,
                    message: "Name or phone number is too long."
                });
            }

            if (
                email.length > 254 ||
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
            ) {
                return sendJSON(res, 400, {
                    success: false,
                    message: "Please enter a valid email address."
                });
            }

            if (
                pickup.length > 200 ||
                destination.length > 200
            ) {
                return sendJSON(res, 400, {
                    success: false,
                    message: "Pickup or destination is too long."
                });
            }

            if (
                canonicalLocation(pickup) ===
                canonicalLocation(destination)
            ) {
                return sendJSON(res, 400, {
                    success: false,
                    message: "Pickup and destination must be different."
                });
            }

            if (!validDate(booking.pickup_date)) {
                return sendJSON(res, 400, {
                    success: false,
                    message: "Please select a valid date."
                });
            }

            const pickupTime =
                normalizeTime(booking.pickup_time);

            if (
                !pickupTime ||
                !isWithinWorkingHours(pickupTime)
            ) {
                return sendJSON(res, 400, {
                    success: false,
                    message: "Bookings are available hourly from 06:00 to 22:00 Iceland time."
                });
            }

            if (
                !isFutureBooking(
                    booking.pickup_date,
                    pickupTime
                )
            ) {
                return sendJSON(res, 400, {
                    success: false,
                    message: "Please select a future pickup time."
                });
            }

            const serviceType = String(
                booking.service_type || "transfer"
            ).trim();

            if (
                ![
                    "transfer",
                    "golden_circle_tour",
                    "northern_lights_tour"
                ].includes(serviceType)
            ) {
                return sendJSON(res, 400, {
                    success: false,
                    message: "Invalid service type."
                });
            }

            const passengers = Number(
                booking.passengers ?? 1
            );

            const luggage = Number(
                booking.luggage ?? 0
            );

            if (
                !Number.isInteger(passengers) ||
                passengers < 1 ||
                passengers > 100 ||
                !Number.isInteger(luggage) ||
                luggage < 0 ||
                luggage > 100
            ) {
                return sendJSON(res, 400, {
                    success: false,
                    message: "Invalid passenger or luggage count."
                });
            }

            let price;
            let tourDetails = null;

            if (serviceType === "golden_circle_tour") {
                tourDetails =
                    calculateGoldenCirclePrice(booking);

                price = tourDetails.total;

            } else if (
                serviceType === "northern_lights_tour"
            ) {
                tourDetails =
                    calculateNorthernLightsPrice(booking);

                price = tourDetails.total;

            } else {
                price = getRoutePrice(
                    pickup,
                    destination
                );
            }

            const available = await checkSlotAvailable(
                booking.pickup_date,
                pickupTime,
                serviceType
            );

            if (!available) {
                return sendJSON(res, 409, {
                    success: false,
                    code: "TIME_SLOT_TAKEN",
                    message: "This time conflicts with another booking. Please choose another time."
                });
            }

            const durationHours =
                getDurationHours(serviceType);

            const startDate = toIcelandUTCDate(
                booking.pickup_date,
                pickupTime
            );

            const endDate = new Date(
                startDate.getTime() +
                durationHours * 3600000
            );

            const cancellationToken =
                makeCancellationToken();

            const existingNotes = booking.special_requests
                ? String(booking.special_requests)
                    .trim()
                    .slice(0, 1800)
                : "";

            const customStopNote =
                serviceType === "golden_circle_tour" &&
                tourDetails.custom_stop_requires_confirmation
                    ? "CUSTOM LOCATION REQUESTED: Confirm feasibility and any additional price with the driver."
                    : "";

            const specialRequests = [
                existingNotes,
                customStopNote
            ]
                .filter(Boolean)
                .join("\n\n")
                .slice(0, 2000);

            const newBooking = {
                full_name: fullName,
                email,
                phone,
                pickup_location: pickup,
                destination,
                pickup_date: booking.pickup_date,
                pickup_time: pickupTime,
                passengers,
                luggage,

                flight_number: booking.flight_number
                    ? String(booking.flight_number)
                        .trim()
                        .slice(0, 50)
                    : null,

                special_requests: specialRequests || null,

                service_type: serviceType,

                package_type: tourDetails
                    ? tourDetails.package_type
                    : null,

                addons: serviceType === "golden_circle_tour"
                    ? tourDetails.addons
                    : [],

                selected_stops:
                    serviceType === "golden_circle_tour"
                        ? tourDetails.selected_stops
                        : [],

                extras_total: tourDetails
                    ? tourDetails.extras_total
                    : 0,

                service_duration_hours: durationHours,
                trip_end_time: endDate.toISOString(),
                price,
                status: "confirmed",
                cancellation_token: cancellationToken
            };

            const { data, error } = await supabase
                .from("bookings")
                .insert([newBooking])
                .select(
                    "id, full_name, email, phone, pickup_location, destination, pickup_date, pickup_time, passengers, luggage, price, status, created_at, service_type, package_type, addons, selected_stops, extras_total, service_duration_hours, trip_end_time"
                )
                .single();

            if (error) {
                console.error(
                    "Booking error:",
                    error.message
                );

                if (error.code === "23505") {
                    return sendJSON(res, 409, {
                        success: false,
                        code: "TIME_SLOT_TAKEN",
                        message: "This time has already been booked. Please choose another time."
                    });
                }

                return sendJSON(res, 500, {
                    success: false,
                    message: "Could not save the booking. Please try again."
                });
            }

            const cancellationUrl =
                `${PUBLIC_SERVER_URL}/api/bookings/cancel/${cancellationToken}`;

            const customLocationNeedsConfirmation =
                serviceType === "golden_circle_tour" &&
                tourDetails.custom_stop_requires_confirmation;

            return sendJSON(res, 201, {
                success: true,

                message: customLocationNeedsConfirmation
                    ? "Your booking has been received. The driver must confirm the custom location and any additional price."
                    : "Your booking has been confirmed.",

                booking: data,
                tour_details: tourDetails,

                invoice: {
                    invoice_number: `IT-${data.id}`,
                    currency: CURRENCY,
                    amount: price,
                    payment_status: "Payment not processed",

                    base_price: tourDetails
                        ? tourDetails.base_price
                        : price,

                    extras_total: tourDetails
                        ? tourDetails.extras_total
                        : 0,

                    addons: serviceType === "golden_circle_tour"
                        ? tourDetails.addons
                        : [],

                    extras: serviceType === "northern_lights_tour"
                        ? tourDetails.extras
                        : [],

                    selected_stops:
                        serviceType === "golden_circle_tour"
                            ? tourDetails.selected_stops
                            : [],

                    custom_stop_requires_confirmation:
                        Boolean(customLocationNeedsConfirmation)
                },

                cancellation_url: cancellationUrl,

                cancellation_policy:
                    "Cancellation is allowed only more than 24 hours before pickup."
            });

        } catch (error) {
            console.error(
                "Booking processing error:",
                error.message
            );

            return sendJSON(res, 400, {
                success: false,
                message: error.message ||
                    "An unexpected error occurred. Please try again."
            });
        }
    }

    // CANCEL BOOKING

    const cancelMatch = pathname.match(
        /^\/api\/bookings\/cancel\/([a-f0-9]{64})$/
    );

    if (
        req.method === "POST" &&
        cancelMatch
    ) {
        if (!checkRateLimit(req)) {
            return sendJSON(res, 429, {
                success: false,
                message: "Too many requests. Please wait and try again."
            });
        }

        try {
            const token = cancelMatch[1];

            const { data: booking, error } = await supabase
                .from("bookings")
                .select(
                    "id, pickup_date, pickup_time, status"
                )
                .eq("cancellation_token", token)
                .maybeSingle();

            if (error) {
                console.error(
                    "Cancellation lookup error:",
                    error.message
                );

                return sendJSON(res, 500, {
                    success: false,
                    message: "Could not process the cancellation."
                });
            }

            if (!booking) {
                return sendJSON(res, 404, {
                    success: false,
                    message: "Booking not found or cancellation link is invalid."
                });
            }

            if (booking.status === "cancelled") {
                return sendJSON(res, 200, {
                    success: true,
                    message: "This booking has already been cancelled."
                });
            }

            if (booking.status !== "confirmed") {
                return sendJSON(res, 409, {
                    success: false,
                    message: "This booking cannot be cancelled in its current status."
                });
            }

            const time = normalizeTime(
                String(booking.pickup_time).slice(0, 8)
            );

            if (
                !time ||
                !isMoreThan24HoursAway(
                    booking.pickup_date,
                    time
                )
            ) {
                return sendJSON(res, 403, {
                    success: false,
                    code: "CANCELLATION_WINDOW_CLOSED",
                    message: "Cancellation is only allowed more than 24 hours before pickup."
                });
            }

            const {
                data: updatedRows,
                error: updateError
            } = await supabase
                .from("bookings")
                .update({
                    status: "cancelled",
                    cancelled_at: new Date().toISOString()
                })
                .eq("id", booking.id)
                .eq("status", "confirmed")
                .select("id");

            if (updateError) {
                console.error(
                    "Cancellation update error:",
                    updateError.message
                );

                return sendJSON(res, 500, {
                    success: false,
                    message: "Could not cancel the booking. Please try again."
                });
            }

            if (
                !updatedRows ||
                updatedRows.length === 0
            ) {
                return sendJSON(res, 409, {
                    success: false,
                    message: "This booking has already changed. Please refresh and check its status."
                });
            }

            return sendJSON(res, 200, {
                success: true,
                message: "Your booking has been cancelled successfully.",
                booking_id: booking.id
            });

        } catch (error) {
            console.error(
                "Cancellation error:",
                error.message
            );

            return sendJSON(res, 500, {
                success: false,
                message: "Could not process the cancellation."
            });
        }
    }

    return sendJSON(res, 404, {
        success: false,
        message: "Endpoint not found."
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(
        `Iceland Transfer server running on port ${PORT}`
    );
});
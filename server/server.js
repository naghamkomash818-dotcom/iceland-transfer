require("dotenv").config();

const http = require("http");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.error("ERROR: Supabase environment variables are missing.");
    process.exit(1);
}

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SECRET_KEY
);

// ==================================================
// CONFIGURATION
// Prices are temporary examples in Icelandic krona.
// Change these values when the driver confirms prices.
// ==================================================

const CURRENCY = "ISK";

const WORK_START_HOUR = 6;
const LAST_TRIP_START_HOUR = 22;

// Price lookup ignores capitalization and extra spaces.
const ROUTE_PRICES = {
    "keflavik airport|reykjavik": 20000,
    "reykjavik|keflavik airport": 20000,

    "reykjavik|blue lagoon": 25000,
    "keflavik airport|blue lagoon": 12000,

    "reykjavik|golden circle": 45000,
    "reykjavik|sky lagoon": 15000,
    "reykjavik|cruise port": 8000
};

// Temporary fallback price for other routes.
const DEFAULT_ROUTE_PRICE = 30000;

// ==================================================
// HELPERS
// ==================================================

function sendJSON(res, statusCode, data) {
    if (res.writableEnded) return;

    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8"
    });

    res.end(JSON.stringify(data));
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

    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = match[2];
    const seconds = match[3] || "00";

    // Hourly bookings only.
    if (minutes !== "00" || seconds !== "00") {
        return null;
    }

    return `${String(hours).padStart(2, "0")}:00:00`;
}

function normalizeLocation(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function getRoutePrice(pickup, destination) {
    const routeKey =
        `${normalizeLocation(pickup)}|${normalizeLocation(destination)}`;

    return ROUTE_PRICES[routeKey] ?? DEFAULT_ROUTE_PRICE;
}

// Iceland local time, including daylight-saving changes.
function getIcelandDateTime() {
    const parts = new Intl.DateTimeFormat("en-CA", {
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
    const currentTime =
        `${String(now.hour).padStart(2, "0")}:` +
        `${String(now.minute).padStart(2, "0")}:` +
        `${String(now.second).padStart(2, "0")}`;

    if (date > now.date) return true;
    if (date < now.date) return false;

    return time.slice(0, 8) > currentTime;
}

function isMoreThan24HoursAway(date, time) {
    // Iceland is UTC+0. Compare timestamps consistently.
    const tripTimestamp = Date.parse(`${date}T${time}Z`);
    const nowTimestamp = Date.now();

    return tripTimestamp - nowTimestamp > 24 * 60 * 60 * 1000;
}

function makeCancellationToken() {
    return crypto.randomBytes(32).toString("hex");
}

function getRequestBody(req, callback) {
    let body = "";
    let tooLarge = false;

    req.on("data", chunk => {
        body += chunk.toString();

        if (body.length > 100000) {
            tooLarge = true;
        }
    });

    req.on("end", () => {
        if (tooLarge) {
            callback(new Error("REQUEST_TOO_LARGE"));
            return;
        }

        try {
            callback(null, JSON.parse(body));
        } catch {
            callback(new Error("INVALID_JSON"));
        }
    });

    req.on("error", () => {
        callback(new Error("REQUEST_READ_ERROR"));
    });
}

// ==================================================
// SERVER
// ==================================================

const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS"
    );
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type"
    );

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    const requestURL = new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`
    );

    // Health check
    if (
        req.method === "GET" &&
        requestURL.pathname === "/health"
    ) {
        return sendJSON(res, 200, {
            success: true,
            message: "Iceland Transfer server is running."
        });
    }

    // ==================================================
    // AVAILABLE TIMES
    // GET /api/availability?date=YYYY-MM-DD
    // ==================================================

    if (
        req.method === "GET" &&
        requestURL.pathname === "/api/availability"
    ) {
        try {
            const date = requestURL.searchParams.get("date");

            if (!validDate(date)) {
                return sendJSON(res, 400, {
                    success: false,
                    message: "Please provide a valid date."
                });
            }

            const { data, error } = await supabase
                .from("bookings")
                .select("pickup_time")
                .eq("pickup_date", date)
                .neq("status", "cancelled");

            if (error) {
                console.error("Availability error:", error.message);

                return sendJSON(res, 500, {
                    success: false,
                    message: "Could not load available times."
                });
            }

            const bookedTimes = [
                ...new Set(
                    (data || [])
                        .map(row => {
                            return normalizeTime(
                                String(row.pickup_time || "").slice(0, 8)
                            );
                        })
                        .filter(Boolean)
                        .map(time => time.slice(0, 5))
                )
            ];

            const now = getIcelandDateTime();

            const availableTimes = [];

            for (
                let hour = WORK_START_HOUR;
                hour <= LAST_TRIP_START_HOUR;
                hour++
            ) {
                const time =
                    `${String(hour).padStart(2, "0")}:00`;

                if (bookedTimes.includes(time)) continue;

                if (date < now.date) continue;

                if (date === now.date) {
                    const currentMinutes =
                        now.hour * 60 + now.minute;

                    const slotMinutes = hour * 60;

                    if (slotMinutes <= currentMinutes) continue;
                }

                availableTimes.push(time);
            }

            return sendJSON(res, 200, {
                success: true,
                date,
                currency: CURRENCY,
                available_times: availableTimes,
                booked_times: bookedTimes
            });
        } catch (error) {
            console.error("Availability error:", error.message);

            return sendJSON(res, 500, {
                success: false,
                message: "Could not load available times."
            });
        }
    }

    // ==================================================
    // CREATE BOOKING
    // POST /api/bookings
    // ==================================================

    if (
        req.method === "POST" &&
        requestURL.pathname === "/api/bookings"
    ) {
        return getRequestBody(req, async (bodyError, booking) => {
            if (bodyError) {
                return sendJSON(
                    res,
                    bodyError.message === "REQUEST_TOO_LARGE" ? 413 : 400,
                    {
                        success: false,
                        message: "Invalid booking request."
                    }
                );
            }

            try {
                const requiredFields = [
                    "full_name",
                    "email",
                    "phone",
                    "pickup_location",
                    "destination",
                    "pickup_date",
                    "pickup_time"
                ];

                for (const field of requiredFields) {
                    if (
                        typeof booking[field] !== "string" ||
                        !booking[field].trim()
                    ) {
                        return sendJSON(res, 400, {
                            success: false,
                            message: `Missing or invalid field: ${field}`
                        });
                    }
                }

                const email = booking.email.trim();

                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    return sendJSON(res, 400, {
                        success: false,
                        message: "Please enter a valid email."
                    });
                }

                if (!validDate(booking.pickup_date)) {
                    return sendJSON(res, 400, {
                        success: false,
                        message: "Please select a valid date."
                    });
                }

                const pickupTime = normalizeTime(booking.pickup_time);

                if (!pickupTime) {
                    return sendJSON(res, 400, {
                        success: false,
                        message: "Please select an hourly pickup time."
                    });
                }

                const pickup = booking.pickup_location.trim();
                const destination = booking.destination.trim();

                if (
                    normalizeLocation(pickup) ===
                    normalizeLocation(destination)
                ) {
                    return sendJSON(res, 400, {
                        success: false,
                        message: "Pickup and destination must be different."
                    });
                }

                if (!isWithinWorkingHours(pickupTime)) {
                    return sendJSON(res, 400, {
                        success: false,
                        message: "Bookings are available from 06:00 to 22:00 Iceland time."
                    });
                }

                if (!isFutureBooking(booking.pickup_date, pickupTime)) {
                    return sendJSON(res, 400, {
                        success: false,
                        message: "Please select a future pickup time."
                    });
                }

                const passengers = Number(booking.passengers ?? 1);
                const luggage = Number(booking.luggage ?? 0);

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

                // The server calculates the price.
                // Do not trust a price supplied by the browser.
                const price = getRoutePrice(pickup, destination);

                const cancellationToken = makeCancellationToken();

                const newBooking = {
                    full_name: booking.full_name.trim(),
                    email,
                    phone: booking.phone.trim(),
                    pickup_location: pickup,
                    destination,
                    pickup_date: booking.pickup_date,
                    pickup_time: pickupTime,
                    passengers,
                    luggage,

                    flight_number: booking.flight_number
                        ? String(booking.flight_number).trim()
                        : null,

                    special_requests: booking.special_requests
                        ? String(booking.special_requests).trim()
                        : null,

                    price,
                    status: "confirmed",
                    cancellation_token: cancellationToken
                };

                const { data, error } = await supabase
                    .from("bookings")
                    .insert([newBooking])
                    .select(
                        "id, full_name, email, phone, pickup_location, destination, pickup_date, pickup_time, passengers, luggage, price, status, created_at"
                    )
                    .single();

                if (error) {
                    console.error("Booking error:", error.message);

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

                // The returned cancellation link must be treated as private.
                const cancellationUrl =
                    `${requestURL.origin}/api/bookings/cancel/` +
                    cancellationToken;

                return sendJSON(res, 201, {
                    success: true,
                    message: "Your booking has been confirmed.",
                    booking: data,
                    invoice: {
                        invoice_number: `IT-${data.id}`,
                        currency: CURRENCY,
                        amount: price,
                        payment_status: "Payment not processed"
                    },
                    cancellation_url: cancellationUrl,
                    cancellation_policy: "Cancellation is allowed only more than 24 hours before pickup."
                });
            } catch (error) {
                console.error("Booking processing error:", error.message);

                return sendJSON(res, 500, {
                    success: false,
                    message: "An unexpected error occurred."
                });
            }
        });
    }

    // ==================================================
    // CANCEL BOOKING
    // POST /api/bookings/cancel/:token
    // ==================================================

    const cancelMatch = requestURL.pathname.match(
        /^\/api\/bookings\/cancel\/([a-f0-9]{64})$/
    );

    if (cancelMatch && req.method === "POST") {
        try {
            const token = cancelMatch[1];

            const { data: booking, error } = await supabase
                .from("bookings")
                .select(
                    "id, pickup_date, pickup_time, status, cancellation_token"
                )
                .eq("cancellation_token", token)
                .maybeSingle();

            if (error) {
                console.error("Cancellation lookup error:", error.message);

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

            const time = normalizeTime(
                String(booking.pickup_time).slice(0, 8)
            );

            if (!time || !isMoreThan24HoursAway(booking.pickup_date, time)) {
                return sendJSON(res, 403, {
                    success: false,
                    code: "CANCELLATION_WINDOW_CLOSED",
                    message: "Cancellation is only allowed more than 24 hours before pickup."
                });
            }

            const { error: updateError } = await supabase
                .from("bookings")
                .update({
                    status: "cancelled",
                    cancelled_at: new Date().toISOString()
                })
                .eq("id", booking.id)
                .eq("status", "confirmed");

            if (updateError) {
                console.error("Cancellation update error:", updateError.message);

                return sendJSON(res, 500, {
                    success: false,
                    message: "Could not cancel the booking. Please try again."
                });
            }

            return sendJSON(res, 200, {
                success: true,
                message: "Your booking has been cancelled successfully.",
                booking_id: booking.id
            });
        } catch (error) {
            console.error("Cancellation error:", error.message);

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
    console.log(`Iceland Transfer server running on port ${PORT}`);
});
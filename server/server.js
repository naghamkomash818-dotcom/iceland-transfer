require("dotenv").config();

const http = require("http");
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

// Normalize time to HH:MM:SS.
// This keeps values consistent with a PostgreSQL TIME column.
function normalizeTime(value) {
    if (typeof value !== "string") {
        return null;
    }

    const match = value.trim().match(
        /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/
    );

    if (!match) {
        return null;
    }

    const hours = match[1];
    const minutes = match[2];
    const seconds = match[3] || "00";

    // The booking system currently uses hourly slots.
    if (minutes !== "00" || seconds !== "00") {
        return null;
    }

    return `${hours}:${minutes}:${seconds}`;
}

function validDate(value) {
    if (typeof value !== "string") {
        return false;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const date = new Date(`${value}T00:00:00Z`);

    return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
    );
}

function sendJSON(res, statusCode, data) {
    if (res.writableEnded) {
        return;
    }

    res.writeHead(statusCode);
    res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
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
        requestURL.pathname === "/health" &&
        req.method === "GET"
    ) {
        return sendJSON(res, 200, {
            success: true,
            message: "Iceland Transfer server is running!"
        });
    }

    // Get booked times for a particular date
    if (
        requestURL.pathname === "/api/availability" &&
        req.method === "GET"
    ) {
        try {
            const date = requestURL.searchParams.get("date");

            if (!validDate(date)) {
                return sendJSON(res, 400, {
                    success: false,
                    message: "Please provide a valid date in YYYY-MM-DD format."
                });
            }

            const { data, error } = await supabase
                .from("bookings")
                .select("pickup_time")
                .eq("pickup_date", date);

            if (error) {
                console.error(
                    "Availability error:",
                    error.message
                );

                return sendJSON(res, 500, {
                    success: false,
                    message: "Could not load available times."
                });
            }

            const bookedTimes = [
                ...new Set(
                    (data || [])
                        .map((booking) => {
                            return normalizeTime(
                                String(booking.pickup_time || "")
                                    .slice(0, 8)
                            );
                        })
                        .filter(Boolean)
                        .map((time) => time.slice(0, 5))
                )
            ];

            return sendJSON(res, 200, {
                success: true,
                date: date,
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

    // Create a booking
    if (
        requestURL.pathname === "/api/bookings" &&
        req.method === "POST"
    ) {
        let body = "";

        req.on("error", () => {
            sendJSON(res, 400, {
                success: false,
                message: "Could not read the request."
            });
        });

        req.on("data", (chunk) => {
            body += chunk.toString();

            if (body.length > 100000) {
                sendJSON(res, 413, {
                    success: false,
                    message: "The request is too large."
                });

                req.destroy();
            }
        });

        req.on("end", async () => {
            if (res.writableEnded) {
                return;
            }

            try {
                const booking = JSON.parse(body);

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
                        message: "Invalid passengers or luggage count."
                    });
                }

                const email = booking.email.trim();

                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    return sendJSON(res, 400, {
                        success: false,
                        message: "Please enter a valid email address."
                    });
                }

                if (!validDate(booking.pickup_date)) {
                    return sendJSON(res, 400, {
                        success: false,
                        message: "Please select a valid pickup date."
                    });
                }

                const pickupTime = normalizeTime(
                    booking.pickup_time
                );

                if (!pickupTime) {
                    return sendJSON(res, 400, {
                        success: false,
                        message: "Please select a valid hourly pickup time."
                    });
                }

                const price =
                    booking.price === undefined ||
                    booking.price === null ||
                    booking.price === ""
                        ? null
                        : Number(booking.price);

                if (
                    price !== null &&
                    (!Number.isFinite(price) || price < 0)
                ) {
                    return sendJSON(res, 400, {
                        success: false,
                        message: "Invalid booking price."
                    });
                }

                const newBooking = {
                    full_name: booking.full_name.trim(),
                    email: email,
                    phone: booking.phone.trim(),
                    pickup_location: booking.pickup_location.trim(),
                    destination: booking.destination.trim(),
                    pickup_date: booking.pickup_date,
                    pickup_time: pickupTime,
                    passengers: passengers,
                    luggage: luggage,

                    flight_number: booking.flight_number
                        ? String(booking.flight_number).trim()
                        : null,

                    special_requests: booking.special_requests
                        ? String(booking.special_requests).trim()
                        : null,

                    price: price,

                    // Automatically confirmed after successful insertion.
                    status: "confirmed"
                };

                const { data, error } = await supabase
                    .from("bookings")
                    .insert([newBooking])
                    .select("id, status, created_at")
                    .single();

                if (error) {
                    console.error(
                        "Supabase booking error:",
                        error.message
                    );

                    // PostgreSQL unique constraint violation:
                    // another booking already occupies this slot.
                    if (error.code === "23505") {
                        return sendJSON(res, 409, {
                            success: false,
                            code: "TIME_SLOT_TAKEN",
                            message: "Sorry, this time is already booked. Please choose another time."
                        });
                    }

                    return sendJSON(res, 500, {
                        success: false,
                        message: "Could not save the booking. Please try again."
                    });
                }

                return sendJSON(res, 201, {
                    success: true,
                    message: "Your booking has been confirmed successfully!",
                    booking: data
                });
            } catch (error) {
                return sendJSON(res, 400, {
                    success: false,
                    message: "Invalid booking data."
                });
            }
        });

        return;
    }

    return sendJSON(res, 404, {
        success: false,
        message: "Page not found."
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(
        `Iceland Transfer server running on port ${PORT}`
    );
});
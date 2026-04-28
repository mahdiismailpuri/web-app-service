/**
 * Web App Service - Edge Runtime Handler
 * 
 * This module provides a lightweight HTTP request handler for Vercel Edge Runtime.
 * It processes incoming requests, manages headers, and forwards them to a configured
 * remote server while preserving client information.
 * 
 * Features:
 * - Edge runtime for low-latency processing
 * - Automatic header filtering and sanitization
 * - Client IP preservation
 * - Support for all HTTP methods
 * - Error handling and logging
 * 
 * @module api/main
 * @version 2.1.0
 */

// Configure this function to run on Vercel Edge Runtime
// Edge runtime provides faster response times by running closer to users
export const config = { runtime: "edge" };

/**
 * The remote server address where requests will be forwarded.
 * This is configured via the TARGET_DOMAIN environment variable.
 * If not set, the service will return a configuration error.
 * 
 * Environment variable: TARGET_DOMAIN
 * Example: https://example.com
 */
const REMOTE_SERVER = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

/**
 * List of HTTP headers that should be excluded when forwarding requests.
 * These headers are typically added by intermediaries (proxies, load balancers)
 * and should not be forwarded to preserve security and prevent header conflicts.
 * 
 * Excluded headers include:
 * - Connection management headers (host, connection, keep-alive)
 * - Authentication headers (proxy-authenticate, proxy-authorization)
 * - Transfer encoding headers (te, trailer, transfer-encoding, upgrade)
 * - Forwarding headers (forwarded, x-forwarded-*)
 */
const EXCLUDED_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

/**
 * Extracts the client's IP address from the request headers.
 * 
 * This function checks multiple possible header locations for the client IP:
 * 1. x-real-ip header (common in many proxy setups)
 * 2. x-forwarded-for header (standard forwarding header)
 * 
 * The function prioritizes x-real-ip and falls back to x-forwarded-for if needed.
 * 
 * @param {Headers} headers - The incoming request headers
 * @returns {string|null} The client IP address, or null if not found
 * 
 * @example
 * const ip = await getClientIp(request.headers);
 * if (ip) {
 *   console.log('Client IP:', ip);
 * }
 */
async function getClientIp(headers) {
  let ip = null;
  
  // Iterate through all headers to find the client IP
  for (const [key, value] of headers) {
    // Check for x-real-ip header first (highest priority)
    if (key === "x-real-ip") {
      ip = value;
      break;
    }
    // Fall back to x-forwarded-for if x-real-ip is not present
    if (key === "x-forwarded-for" && !ip) {
      ip = value;
    }
  }
  
  return ip;
}

/**
 * Prepares and sanitizes headers for forwarding to the remote server.
 * 
 * This function performs the following operations:
 * 1. Extracts the client IP address
 * 2. Filters out excluded headers (those in EXCLUDED_HEADERS)
 * 3. Removes Vercel-specific headers (x-vercel-*)
 * 4. Removes IP-related headers that will be re-added
 * 5. Adds the x-forwarded-for header with the client IP
 * 
 * This ensures that only relevant and safe headers are forwarded.
 * 
 * @param {Headers} inputHeaders - The incoming request headers
 * @returns {Headers} A new Headers object with sanitized headers
 * 
 * @example
 * const cleanHeaders = await prepareHeaders(request.headers);
 * // cleanHeaders now contains only safe headers to forward
 */
async function prepareHeaders(inputHeaders) {
  const output = new Headers();
  
  // Extract client IP before processing headers
  const clientIp = await getClientIp(inputHeaders);
  
  // Process each header from the incoming request
  for (const [key, value] of inputHeaders) {
    // Skip headers that are in the exclusion list
    if (EXCLUDED_HEADERS.has(key)) continue;
    
    // Skip Vercel-specific headers (internal infrastructure)
    if (key.startsWith("x-vercel-")) continue;
    
    // Skip IP headers that will be re-added with the correct value
    if (key === "x-real-ip" || key === "x-forwarded-for") continue;
    
    // Add the header to the output
    output.set(key, value);
  }
  
  // Add the x-forwarded-for header with the client IP
  // This preserves the original client information for the remote server
  if (clientIp) {
    output.set("x-forwarded-for", clientIp);
  }
  
  return output;
}

/**
 * Constructs the target URL by combining the remote server base URL
 * with the path from the incoming request.
 * 
 * This function extracts the path portion (everything after the domain)
 * from the original URL and appends it to the REMOTE_SERVER base URL.
 * 
 * @param {string} originalUrl - The full incoming request URL
 * @returns {string} The complete target URL for forwarding
 * 
 * @example
 * // If REMOTE_SERVER is "https://api.example.com"
 * // and originalUrl is "https://mysite.com/users/123"
 * // Returns: "https://api.example.com/users/123"
 */
function buildUrl(originalUrl) {
  // Find the start of the path (after "https://")
  // The index 8 skips "https://" (8 characters)
  const idx = originalUrl.indexOf("/", 8);
  
  // If no path is found, append a slash
  // Otherwise, append the extracted path
  return idx === -1 
    ? REMOTE_SERVER + "/" 
    : REMOTE_SERVER + originalUrl.slice(idx);
}

/**
 * Determines whether the HTTP method should include a request body.
 * 
 * According to HTTP specifications, GET and HEAD requests should not have a body.
 * All other methods (POST, PUT, PATCH, DELETE, etc.) may include a body.
 * 
 * @param {string} method - The HTTP method (GET, POST, etc.)
 * @returns {boolean} True if the method should include a body, false otherwise
 * 
 * @example
 * hasRequestBody("GET");    // returns false
 * hasRequestBody("POST");   // returns true
 * hasRequestBody("DELETE"); // returns true
 */
function hasRequestBody(method) {
  return method !== "GET" && method !== "HEAD";
}

/**
 * Main request handler for the web service.
 * 
 * This is the entry point for all incoming HTTP requests. It performs
 * the following operations:
 * 
 * 1. Validates that REMOTE_SERVER is configured
 * 2. Constructs the target URL
 * 3. Sanitizes and prepares headers
 * 4. Determines if a request body should be included
 * 5. Forwards the request to the remote server
 * 6. Handles errors and returns appropriate responses
 * 
 * @param {Request} req - The incoming HTTP request
 * @returns {Promise<Response>} The response from the remote server or an error response
 * 
 * @example
 * // This function is automatically called by Vercel for each request
 * export default async function handleRequest(req) {
 *   // ... processing logic
 * }
 */
export default async function handleRequest(req) {
  // Validate configuration - return error if remote server is not set
  if (!REMOTE_SERVER) {
    return new Response("Setup Required: Server address missing", { status: 500 });
  }

  try {
    // Build the complete target URL
    const target = buildUrl(req.url);
    
    // Prepare sanitized headers for forwarding
    const headers = await prepareHeaders(req.headers);
    
    // Get the HTTP method from the request
    const method = req.method;
    
    // Forward the request to the remote server
    return await fetch(target, {
      method: method,
      headers: headers,
      // Include body only for methods that support it
      body: hasRequestBody(method) ? req.body : undefined,
      // Enable duplex streaming for proper body handling
      duplex: "half",
      // Don't follow redirects automatically - let the client handle them
      redirect: "manual",
    });
  } catch (err) {
    // Log the error for debugging
    console.error("Error:", err);
    
    // Return a generic error response
    return new Response("Request Failed", { status: 502 });
  }
}

/**
 * END OF FILE
 * 
 * This module is designed to be deployed on Vercel Edge Runtime for optimal
 * performance. The code is structured for readability and maintainability,
 * with clear separation of concerns through helper functions.
 * 
 * For deployment instructions, see the Vercel documentation:
 * https://vercel.com/docs/concepts/functions/edge-functions
 */

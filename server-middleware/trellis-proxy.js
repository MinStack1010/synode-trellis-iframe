const http = require("http");

// Used only by `nuxt dev`. Production requests use the matching Nginx proxy.
const upstream = new URL(
    process.env.TRELLIS_PROXY_TARGET || "http://35.238.30.208:58203"
);

module.exports = (request, response) => {
    const proxyRequest = http.request({
        hostname: upstream.hostname,
        port: upstream.port || 80,
        path: request.url,
        method: request.method,
        headers: { ...request.headers, host: upstream.host }
    }, (proxyResponse) => {
        response.writeHead(proxyResponse.statusCode, proxyResponse.headers);
        proxyResponse.pipe(response);
    });

    proxyRequest.on("error", () => {
        if (!response.headersSent) {
            response.writeHead(502, { "Content-Type": "application/json" });
        }
        response.end(JSON.stringify({ detail: "TRELLIS backend is unavailable" }));
    });

    request.pipe(proxyRequest);
};

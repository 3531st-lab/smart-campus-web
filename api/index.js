const handler = require("../server/index");

module.exports = (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const route = url.searchParams.get("route");
  if (route) {
    url.searchParams.delete("route");
    const query = url.searchParams.toString();
    req.url = `/api/${route}${query ? `?${query}` : ""}`;
  }
  return handler(req, res);
};

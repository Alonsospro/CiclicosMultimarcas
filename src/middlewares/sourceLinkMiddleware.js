// Links to the Google Sheets files and Drive folders behind the inventories are
// visible to administrators only. Removing them from every API response (not
// just hiding them in the UI) keeps them out of encargado/auxiliar sessions.
// Photo links (Drive file/thumbnail URLs) are evidence and are kept.
const SOURCE_LINK = /^https?:\/\/(docs\.google\.com\/spreadsheets\/|drive\.google\.com\/(drive\/)?(u\/\d+\/)?folders\/)/i;

const canSeeSourceLinks = user => !!user && (user.isSuperadmin === true || user.role === 'ADMIN');

function stripSourceLinks(value) {
  if (typeof value === 'string') return SOURCE_LINK.test(value.trim()) ? null : value;
  if (Array.isArray(value)) return value.map(stripSourceLinks);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const [key, entry] of Object.entries(value)) out[key] = stripSourceLinks(entry);
    return out;
  }
  return value;
}

function hideSourceLinks(req, res, next) {
  const json = res.json.bind(res);
  // req.user is set by the route's authenticate middleware, which runs before the response is sent.
  res.json = body => json(canSeeSourceLinks(req.user) ? body : stripSourceLinks(body));
  next();
}

module.exports = hideSourceLinks;
module.exports.stripSourceLinks = stripSourceLinks;
module.exports.canSeeSourceLinks = canSeeSourceLinks;

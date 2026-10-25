// Translate the parsed page into the visitor's language.
//
// index.html loads this right after core/i18n.js and the strings files, at
// the end of the body and before the CDN scripts. The parser stops at each
// of those until it has downloaded, so translating here, not in init(), is
// what keeps a visitor who reads English from seeing the Turkish markup
// while ONNX Runtime downloads, or for good if a CDN never answers.
//
// The markup is authored in Turkish, so a Turkish page needs no pass. A
// failure, strings that never loaded included, leaves the Turkish markup
// standing and must not end the parse; <html lang> then says it is Turkish,
// or a screen reader would read it with the voice of the language chosen.
// Either way the page is shown: lang-boot.js hid it until this ran.

try {
  if (currentLanguage() !== "tr") translatePage("tr");
} catch (err) {
  document.documentElement.setAttribute("lang", "tr");
  console.warn("Could not translate the page:", err);
} finally {
  document.documentElement.removeAttribute("data-i18n-pending");
}

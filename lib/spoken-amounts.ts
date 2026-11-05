/**
 * Converts spoken Hindi/Hinglish amounts and Devanagari digits to ASCII digits,
 * e.g. "do hazaar paanch sau" -> "2500", "₹१५००" -> "₹1500", "2 lakh" -> "200000".
 *
 * Only whole scale words are recognised. A bare "l"/"L" or "k" is deliberately
 * NOT treated as lakh/thousand: "2l doodh" is 2 litres, not ₹2,00,000.
 */

const DEVANAGARI_DIGITS = "०१२३४५६७८९";

const nfcKeys = (entries: Record<string, number>) =>
  Object.fromEntries(Object.entries(entries).map(([key, value]) => [key.normalize("NFC").toLowerCase(), value]));

const WORD_NUMBERS: Record<string, number> = nfcKeys({
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, chhah: 6,
  saat: 7, aath: 8, nau: 9, das: 10, dedh: 1.5, dhai: 2.5, dhaai: 2.5,
  "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5, "छह": 6, "सात": 7,
  "आठ": 8, "नौ": 9, "दस": 10, "डेढ़": 1.5, "ढाई": 2.5,
});

const SCALES: Record<string, number> = nfcKeys({
  sau: 100,
  hazaar: 1000, hazar: 1000, hajar: 1000, hajaar: 1000, thousand: 1000,
  lakh: 100000, lakhs: 100000, lac: 100000, lacs: 100000,
  "सौ": 100, "हज़ार": 1000, "हजार": 1000, "लाख": 100000,
});

const alternation = (words: Record<string, number>) =>
  Object.keys(words)
    .sort((a, b) => b.length - a.length)
    .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

const NUMBER = `(?:\\d+(?:\\.\\d+)?|${alternation(WORD_NUMBERS)})`;
const SCALE = `(?:${alternation(SCALES)})`;
const GROUP = `${NUMBER}\\s*${SCALE}`;
// Unicode-aware word edges so Devanagari vowel signs (\p{M}) count as part of a word.
const EDGE_LEFT = "(?<![\\p{L}\\p{M}\\p{N}])";
const EDGE_RIGHT = "(?![\\p{L}\\p{M}\\p{N}])";

// Built with RegExp() so the ES2017 compile target does not reject lookbehind.
const CHAIN = new RegExp(`${EDGE_LEFT}${GROUP}(?:\\s+(?:aur\\s+)?${GROUP})*${EDGE_RIGHT}`, "giu");
const ONE_GROUP = new RegExp(`(${NUMBER})\\s*(${SCALE})`, "giu");

export function normalizeSpokenAmounts(text: string): string {
  const ascii = text
    .normalize("NFC")
    .replace(/[०-९]/g, digit => String(DEVANAGARI_DIGITS.indexOf(digit)));
  return ascii.replace(CHAIN, chain => {
    let total = 0;
    for (const match of chain.matchAll(ONE_GROUP)) {
      const word = match[1].toLowerCase();
      const value = /^\d/.test(word) ? Number(word) : WORD_NUMBERS[word];
      total += value * SCALES[match[2].toLowerCase()];
    }
    return Number.isFinite(total) && total > 0 ? String(Math.round(total)) : chain;
  });
}

import { normalize } from "./text";

/** Every country calling code (ITU-T E.164). None begins another, so a number's digits start with one code at most. */
const CALLING_CODES = new Set((
  "1 7 20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 "
  + "92 93 94 95 98 211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 238 239 240 "
  + "241 242 243 244 245 246 247 248 249 250 251 252 253 254 255 256 257 258 260 261 262 263 264 265 266 267 268 269 290 291 "
  + "297 298 299 350 351 352 353 354 355 356 357 358 359 370 371 372 373 374 375 376 377 378 379 380 381 382 383 385 386 387 "
  + "389 420 421 423 500 501 502 503 504 505 506 507 508 509 590 591 592 593 594 595 596 597 598 599 670 672 673 674 675 676 "
  + "677 678 679 680 681 682 683 685 686 687 688 689 690 691 692 850 852 853 855 856 880 886 960 961 962 963 964 965 966 967 "
  + "968 970 971 972 973 974 975 976 977 992 993 994 995 996 998"
).split(" "));

export const isCallingCode = (code: string) => CALLING_CODES.has(code);

/** The calling code a run of digits starts with, if any: "919876543210" starts with 91. */
export function callingCodeOf(digits: string): string | null {
  for (let length = 1; length <= 3 && length <= digits.length; length += 1) {
    if (CALLING_CODES.has(digits.slice(0, length))) return digits.slice(0, length);
  }
  return null;
}

/** Countries as addresses and forms name them: the name a form's country list uses, its calling code, then the other
 * ways an address may write it. */
const COUNTRIES: [name: string, code: string, ...aliases: string[]][] = [
  ["United States", "1", "united states of america", "usa", "us", "u s", "u s a", "america"],
  ["India", "91", "bharat", "ind"], ["Canada", "1"],
  ["United Kingdom", "44", "uk", "u k", "great britain", "britain", "england", "scotland", "wales", "northern ireland"],
  ["Ireland", "353"], ["Australia", "61"], ["New Zealand", "64"], ["Singapore", "65"], ["Malaysia", "60"],
  ["Indonesia", "62"], ["Philippines", "63"], ["Thailand", "66"], ["Vietnam", "84", "viet nam"], ["China", "86"],
  ["Hong Kong", "852"], ["Taiwan", "886"], ["Japan", "81"], ["South Korea", "82", "korea", "republic of korea"],
  ["Pakistan", "92"], ["Bangladesh", "880"], ["Sri Lanka", "94"], ["Nepal", "977"], ["Bhutan", "975"], ["Maldives", "960"],
  ["Myanmar", "95"], ["Afghanistan", "93"], ["United Arab Emirates", "971", "uae", "u a e", "emirates"],
  ["Saudi Arabia", "966", "ksa"], ["Qatar", "974"], ["Kuwait", "965"], ["Bahrain", "973"], ["Oman", "968"],
  ["Israel", "972"], ["Jordan", "962"], ["Lebanon", "961"], ["Turkey", "90", "turkiye"], ["Egypt", "20"],
  ["South Africa", "27"], ["Nigeria", "234"], ["Kenya", "254"], ["Ghana", "233"], ["Ethiopia", "251"], ["Morocco", "212"],
  ["Germany", "49", "deutschland"], ["France", "33"], ["Spain", "34"], ["Portugal", "351"], ["Italy", "39"],
  ["Netherlands", "31", "the netherlands", "holland"], ["Belgium", "32"], ["Luxembourg", "352"], ["Switzerland", "41"],
  ["Austria", "43"], ["Sweden", "46"], ["Norway", "47"], ["Denmark", "45"], ["Finland", "358"], ["Iceland", "354"],
  ["Poland", "48"], ["Czech Republic", "420", "czechia"], ["Slovakia", "421"], ["Hungary", "36"], ["Romania", "40"],
  ["Bulgaria", "359"], ["Greece", "30"], ["Croatia", "385"], ["Serbia", "381"], ["Ukraine", "380"], ["Russia", "7", "russian federation"],
  ["Estonia", "372"], ["Latvia", "371"], ["Lithuania", "370"], ["Mexico", "52"], ["Brazil", "55"], ["Argentina", "54"],
  ["Chile", "56"], ["Colombia", "57"], ["Peru", "51"], ["Venezuela", "58"], ["Costa Rica", "506"], ["Panama", "507"],
  ["Guatemala", "502"], ["Dominican Republic", "1"], ["Jamaica", "1"], ["Trinidad and Tobago", "1"], ["Puerto Rico", "1"],
];

const BY_NAME = new Map(COUNTRIES.flatMap(([name, , ...aliases]) => [name, ...aliases].map((alias) => [normalize(alias), name] as const)));
const CODE_OF = new Map(COUNTRIES.map(([name, code]) => [name, code]));

/** States and provinces an address may end with outside the US (`isUsState` has those): India's states and union
 * territories and Canada's provinces and territories, by name and by the codes addresses write them with. */
const REGIONS = new Set([
  "andhra pradesh", "arunachal pradesh", "assam", "bihar", "chhattisgarh", "goa", "gujarat", "haryana", "himachal pradesh",
  "jharkhand", "karnataka", "kerala", "madhya pradesh", "maharashtra", "manipur", "meghalaya", "mizoram", "nagaland",
  "odisha", "orissa", "punjab", "rajasthan", "sikkim", "tamil nadu", "telangana", "tripura", "uttar pradesh", "uttarakhand",
  "uttaranchal", "west bengal", "andaman and nicobar islands", "chandigarh", "dadra and nagar haveli and daman and diu",
  "delhi", "new delhi", "nct of delhi", "jammu and kashmir", "ladakh", "lakshadweep", "puducherry", "pondicherry",
  "ap", "as", "br", "cg", "gj", "hr", "hp", "jh", "ka", "kl", "mh", "mp", "ml", "mz", "od", "pb", "rj", "tn", "ts", "tg", "up",
  "wb", "dl", "jk", "py",
  "alberta", "british columbia", "manitoba", "new brunswick", "newfoundland and labrador", "nova scotia", "ontario",
  "prince edward island", "quebec", "saskatchewan", "northwest territories", "nunavut", "yukon",
  "ab", "bc", "mb", "nb", "nl", "ns", "on", "pe", "qc", "sk", "nt", "nu", "yt",
].map(normalize));

/** India's states and union territories by the codes addresses write them with: "TS" is Telangana. */
export const INDIA_REGIONS: Record<string, string> = {
  ap: "andhra pradesh", as: "assam", br: "bihar", cg: "chhattisgarh", gj: "gujarat", hr: "haryana", hp: "himachal pradesh",
  jh: "jharkhand", ka: "karnataka", kl: "kerala", mh: "maharashtra", mp: "madhya pradesh", ml: "meghalaya", mz: "mizoram",
  od: "odisha", pb: "punjab", rj: "rajasthan", tn: "tamil nadu", ts: "telangana", tg: "telangana", up: "uttar pradesh",
  wb: "west bengal", dl: "delhi", jk: "jammu and kashmir", py: "puducherry",
};

/** Canada's provinces and territories by their codes: "ON" is Ontario. */
export const CANADA_REGIONS: Record<string, string> = {
  ab: "alberta", bc: "british columbia", mb: "manitoba", nb: "new brunswick", nl: "newfoundland and labrador",
  ns: "nova scotia", on: "ontario", pe: "prince edward island", qc: "quebec", sk: "saskatchewan",
  nt: "northwest territories", nu: "nunavut", yt: "yukon",
};

/** Whether a part of an address names a state or province outside the US: "Telangana", "TS", "Ontario". */
export const isKnownRegion = (text: string) => REGIONS.has(normalize(text));

/** The country a part of an address names, as a form's country list would: "USA" is "United States". */
export const countryNamed = (text: string): string | null => BY_NAME.get(normalize(text)) ?? null;

/** A country's calling code, by the name `countryNamed` gives. */
export const callingCodeIn = (country: string): string | null => CODE_OF.get(country) ?? null;

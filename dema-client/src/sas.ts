/**
 * Check words: a short phrase both people can read out to each other to be sure that the connection between them is really
 * between them and nobody sits in the middle. It is computed from both sides' connection fingerprints and ids, so if anyone
 * changed either side's code the two screens show different words. Six words from 256 is 48 bits.
 */
const WORDS = [
  "apple", "arrow", "atlas", "bacon", "badge", "basil", "beach", "bell",
  "berry", "bike", "bird", "blade", "boat", "bolt", "bone", "book",
  "boot", "brave", "bread", "brick", "brush", "cabin", "cable", "cake",
  "camel", "candy", "canoe", "cargo", "carpet", "castle", "cedar", "chair",
  "chalk", "cherry", "chess", "chief", "cider", "cliff", "clock", "cloud",
  "clover", "coast", "cobra", "coffee", "comet", "coral", "cotton", "crab",
  "crane", "crown", "cup", "daisy", "dance", "delta", "denim", "desert",
  "dingo", "disk", "dock", "dove", "dragon", "drum", "eagle", "earth",
  "echo", "elbow", "ember", "engine", "fable", "falcon", "farm", "fern",
  "ferry", "field", "finch", "flame", "flute", "forest", "fox", "frost",
  "galaxy", "garden", "garlic", "gecko", "giant", "ginger", "glass", "globe",
  "goat", "gold", "grape", "grass", "gull", "hammer", "harbor", "hawk",
  "hazel", "heron", "honey", "horse", "house", "igloo", "iguana", "island",
  "ivory", "jacket", "jade", "jaguar", "jelly", "jewel", "jungle", "kayak",
  "kettle", "kite", "kiwi", "koala", "ladder", "lagoon", "lamp", "lemon",
  "lilac", "lion", "lizard", "llama", "lotus", "lunar", "magnet", "mango",
  "maple", "marble", "meadow", "melon", "mint", "mirror", "monkey", "moon",
  "moose", "mouse", "nectar", "needle", "nest", "noodle", "north", "nutmeg",
  "oasis", "ocean", "olive", "onion", "orbit", "orchid", "otter", "owl",
  "oyster", "paddle", "palm", "panda", "paper", "parrot", "peach", "pearl",
  "pebble", "pepper", "piano", "pilot", "pine", "planet", "plum", "polar",
  "pond", "poppy", "prairie", "pumpkin", "puzzle", "quail", "quartz", "quilt",
  "rabbit", "radish", "rain", "raven", "reef", "ribbon", "river", "robin",
  "rocket", "rose", "saddle", "safari", "sailor", "salmon", "sand", "satin",
  "scarf", "seal", "shadow", "shell", "silver", "sketch", "sky", "snow",
  "spark", "spice", "spider", "spoon", "spring", "squid", "star", "stone",
  "storm", "sugar", "summer", "sunset", "swan", "table", "tiger", "timber",
  "toast", "tomato", "torch", "tower", "trail", "tulip", "tunnel", "turtle",
  "valley", "velvet", "violet", "walnut", "whale", "wheat", "willow", "winter",
  "wolf", "wren", "yacht", "yarrow", "zebra", "zephyr", "anchor", "beacon",
  "bridge", "candle", "compass", "dolphin", "feather", "harvest", "lantern", "meteor",
  "mosaic", "pillow", "rainbow", "shuttle", "thunder", "voyage", "window", "orange",
];

export const WORD_COUNT = WORDS.length;

/** The same words on both screens for the same inputs, whichever order they are given in. */
export async function checkWords(parts: string[]): Promise<string> {
  const text = [...parts].map((p) => p.toLowerCase().replaceAll(":", "")).sort().join("|");
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(hash.slice(0, 6), (b) => WORDS[b]).join(" ");
}

/* ════════════════════════════════════════════════════════════════════
   GAME CONTENT
   The default game. Admins change it in the admin file (pins, radii,
   arrival text, challenges) and export a participant file with their
   version sealed inside; the participant build replaces this module with
   that sealed copy.
   COORDINATES, TEXT, CHALLENGES, CLUES AND SUSPECTS BELOW ARE PLACEHOLDERS.

   Locations are listed in play-map order; the pin numbers follow it.
   Location ids are permanent too: completed locations are keyed by them.

   Challenge (task) shape — ids are permanent:
     { id, prompt, image }     text and/or an https picture link
   Nothing is answered on this site: teams answer in LoQuiz.

   Clues & suspects appear on one screen `revealMinutes` before the end of
   each team's `durationMinutes` clock (or once every location is done).

   id is permanent: teams' progress is saved under it, so a re-uploaded
   version of the same game keeps everyone's progress.
   ════════════════════════════════════════════════════════════════════ */
const GAME = {
  id: "chinatown-historical-hunt",
  title: "Historical Hunt — Chinatown",
  // Shown on the start screen, and at the top of the clues & suspects screen.
  intro: "Walk to each location on the map. When you arrive, it opens by itself.",
  revealIntro: "No more locations can be opened. Read the clues and work out which of the suspects did it.",
  durationMinutes: 120,
  revealMinutes: 20,
  defaults: { radius: 25, accuracyCeiling: 50, consecutiveFixes: 3 },
  // Base map. With a Google Maps Platform key (Map Tiles API) the map shows Google's map;
  // without one, OpenStreetMap, which is fine for testing but not allowed for paid events.
  // Never put a real key here: the repository is public. Admins paste it into the admin panel.
  map: { googleKey: "" },
  locations: [
    { id:"telok-ayer-green", name:"Telok Ayer Green", lat:1.28035, lng:103.84705, radius:25,
      arrivalText:"You are standing on what was once the shoreline. Telok Ayer means 'water bay' — every step east of here was sea until the reclamation of the 1880s.",
      tasks: [
        { id:"t-tag-01", prompt:"What does 'Telok Ayer' mean in Malay?" },
        { id:"t-tag-02", prompt:"Which body of water once lapped at this spot? One word." }
      ] },
    { id:"thian-hock-keng", name:"Thian Hock Keng Temple", lat:1.28092, lng:103.84760, radius:22,
      arrivalText:"The Temple of Heavenly Happiness. Hokkien immigrants came here first to give thanks for surviving the crossing.",
      tasks: [
        { id:"t-thk-01", prompt:"Which community built the Temple of Heavenly Happiness?" },
        { id:"t-thk-02", prompt:"Count the stone lions guarding the main entrance." },
        { id:"t-thk-03", prompt:"Travellers came here to give thanks for surviving what?" }
      ] },
    { id:"nagore-dargah", name:"Nagore Dargah", lat:1.28065, lng:103.84740, radius:22,
      arrivalText:"Built by Tamil Muslims from the Coromandel Coast. Note how its upper storey imitates a palace and its lower one a mosque.",
      tasks: [
        { id:"t-nag-01", prompt:"Where did the builders of the Nagore Dargah come from?" },
        { id:"t-nag-02", prompt:"Its lower storey imitates what kind of building?" }
      ] },
    { id:"al-abrar", name:"Al-Abrar Mosque", lat:1.27990, lng:103.84690, radius:22,
      arrivalText:"Once a thatched hut known as Masjid Chulia. The shophouse frontage hides a much older foundation.",
      tasks: [
        { id:"t-alb-01", prompt:"What was the mosque once known as? Two words." },
        { id:"t-alb-02", prompt:"What was the first building on this site?" }
      ] },
    { id:"ying-fo-fui-kun", name:"Ying Fo Fui Kun", lat:1.28150, lng:103.84800, radius:22,
      arrivalText:"A Hakka clan house, and one of the oldest surviving associations in the settlement.",
      tasks: [
        { id:"t-yff-01", prompt:"Ying Fo Fui Kun is a clan house for which community?" },
        { id:"t-yff-02", prompt:"How many doors face the street?" }
      ] },
    { id:"amoy-street", name:"Amoy Street", lat:1.28000, lng:103.84650, radius:28,
      arrivalText:"Named for the port the Hokkiens sailed from. Look up: the five-foot way was a legal requirement of the Town Plan.",
      tasks: [
        { id:"t-amo-01", prompt:"Amoy is the old name of which Chinese port city?" },
        { id:"t-amo-02", prompt:"How wide, in feet, is the covered walkway in front of the shophouses?" }
      ] },
    { id:"club-street", name:"Club Street", lat:1.28120, lng:103.84590, radius:28,
      arrivalText:"The clan associations and social clubs sat up this slope, above the noise of the trading streets.",
      tasks: [
        { id:"t-clb-01", prompt:"Why were the clubs built up this slope?" },
        { id:"t-clb-02", prompt:"Name one kind of association that met on this street." }
      ] },
    { id:"ann-siang-hill", name:"Ann Siang Hill", lat:1.28050, lng:103.84600, radius:28,
      arrivalText:"Once a nutmeg and clove plantation, later the address of letter-writers and remittance houses.",
      tasks: [
        { id:"t-ash-01", prompt:"What grew on Ann Siang Hill before the shophouses?" },
        { id:"t-ash-02", prompt:"Letter-writers here helped workers send what home?" }
      ] }
  ],
  clues: [
    { id:"c-ledger", text:"A torn page from a remittance ledger, dated the night the jade seal vanished, shows one sender crossed out." },
    { id:"c-boots", text:"The temple caretaker saw muddy boots on the steps: the wearer came up from the old shoreline, not down from the hill." },
    { id:"c-letter", text:"A letter-writer on Ann Siang Hill was paid twice his rate to write a note in a hand that wasn't his own." },
    { id:"c-lamp", text:"The lamp at the Hakka clan house burned until dawn, though the association's books say it closed at nine." },
    { id:"c-ship", text:"The harbour master logged a junk leaving for Amoy an hour before sunrise, with one passenger unaccounted for." }
  ],
  suspects: [
    { id:"s-tan", name:"Tan Boon Seng", blurb:"Remittance agent on Telok Ayer Street. Knows every family's savings." },
    { id:"s-rahman", name:"Abdul Rahman", blurb:"Spice trader from the Coromandel Coast, recently in debt." },
    { id:"s-lim", name:"Madam Lim Geok Neo", blurb:"Owner of a Club Street boarding house. Hears everything." },
    { id:"s-chong", name:"Chong Ah Fook", blurb:"Clerk at the Hakka clan association. Keeps the keys." },
    { id:"s-pillai", name:"Rajan Pillai", blurb:"Letter-writer on Ann Siang Hill, known for his fine hand." }
  ]
};

export { GAME };

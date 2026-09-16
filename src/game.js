/* ════════════════════════════════════════════════════════════════════
   GAME CONTENT
   The default game. Admins change it in the admin file (pins, radii,
   arrival text, challenges) and export a participant file with their
   version sealed inside; the participant build replaces this module with
   that sealed copy.
   COORDINATES, TEXT, CHALLENGES, CLUES AND SUSPECTS BELOW ARE PLACEHOLDERS.

   Challenge (task) shape — ids are permanent, answers are keyed by them:
     { id, type:"multiple_choice", prompt, options:[…], answer:<index>, hint }
     { id, type:"text",   prompt, accept:["…", "…"], hint }
     { id, type:"number", prompt, answer:<number>, tolerance:<number>, hint }
   No points on this site: scoring is done in LoQuiz. Answers are recorded, never shown.

   Clues & suspects appear on one screen `revealMinutes` before the end of
   each team's `durationMinutes` clock (or once every location is done).

   id is permanent: teams' progress is saved under it, so a re-uploaded
   version of the same game keeps everyone's progress.
   ════════════════════════════════════════════════════════════════════ */
const GAME = {
  id: "chinatown-historical-hunt",
  title: "Historical Hunt — Chinatown",
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
        { id:"t-tag-01", type:"multiple_choice", prompt:"What does 'Telok Ayer' mean in Malay?", options:["Water bay", "High hill", "Spice market", "Old harbour"], answer:0, hint:"Think about where the shoreline used to be." },
        { id:"t-tag-02", type:"text", prompt:"Which body of water once lapped at this spot? One word.", accept:["sea", "the sea"], hint:"It's salty." }
      ] },
    { id:"thian-hock-keng", name:"Thian Hock Keng Temple", lat:1.28092, lng:103.84760, radius:22,
      arrivalText:"The Temple of Heavenly Happiness. Hokkien immigrants came here first to give thanks for surviving the crossing.",
      tasks: [
        { id:"t-thk-01", type:"multiple_choice", prompt:"Which community built the Temple of Heavenly Happiness?", options:["Cantonese", "Hokkien", "Teochew", "Hainanese"], answer:1, hint:"The same people Amoy Street is connected to." },
        { id:"t-thk-02", type:"number", prompt:"Count the stone lions guarding the main entrance.", answer:2, tolerance:0, hint:"They come in pairs." },
        { id:"t-thk-03", type:"text", prompt:"Travellers came here to give thanks for surviving what?", accept:["the crossing", "crossing", "the voyage", "voyage", "the journey", "journey"], hint:"It happened at sea." }
      ] },
    { id:"nagore-dargah", name:"Nagore Dargah", lat:1.28065, lng:103.84740, radius:22,
      arrivalText:"Built by Tamil Muslims from the Coromandel Coast. Note how its upper storey imitates a palace and its lower one a mosque.",
      tasks: [
        { id:"t-nag-01", type:"multiple_choice", prompt:"Where did the builders of the Nagore Dargah come from?", options:["The Malabar Coast", "The Coromandel Coast", "Sumatra", "Gujarat"], answer:1, hint:"The east coast of southern India." },
        { id:"t-nag-02", type:"text", prompt:"Its lower storey imitates what kind of building?", accept:["mosque", "a mosque"], hint:"Its upper storey imitates a palace." }
      ] },
    { id:"al-abrar", name:"Al-Abrar Mosque", lat:1.27990, lng:103.84690, radius:22,
      arrivalText:"Once a thatched hut known as Masjid Chulia. The shophouse frontage hides a much older foundation.",
      tasks: [
        { id:"t-alb-01", type:"text", prompt:"What was the mosque once known as? Two words.", accept:["masjid chulia", "chulia mosque"], hint:"Masjid …" },
        { id:"t-alb-02", type:"multiple_choice", prompt:"What was the first building on this site?", options:["A brick warehouse", "A thatched hut", "A timber jetty", "A shophouse"], answer:1, hint:"Its roof was made of leaves." }
      ] },
    { id:"ying-fo-fui-kun", name:"Ying Fo Fui Kun", lat:1.28150, lng:103.84800, radius:22,
      arrivalText:"A Hakka clan house, and one of the oldest surviving associations in the settlement.",
      tasks: [
        { id:"t-yff-01", type:"multiple_choice", prompt:"Ying Fo Fui Kun is a clan house for which community?", options:["Hakka", "Hokkien", "Peranakan", "Teochew"], answer:0, hint:"Not the community of the temple down the road." },
        { id:"t-yff-02", type:"number", prompt:"How many doors face the street?", answer:3, tolerance:0, hint:"Stand across the road and count." }
      ] },
    { id:"amoy-street", name:"Amoy Street", lat:1.28000, lng:103.84650, radius:28,
      arrivalText:"Named for the port the Hokkiens sailed from. Look up: the five-foot way was a legal requirement of the Town Plan.",
      tasks: [
        { id:"t-amo-01", type:"text", prompt:"Amoy is the old name of which Chinese port city?", accept:["xiamen", "hsia-men"], hint:"It starts with X today." },
        { id:"t-amo-02", type:"number", prompt:"How wide, in feet, is the covered walkway in front of the shophouses?", answer:5, tolerance:0, hint:"It's in the walkway's name." }
      ] },
    { id:"club-street", name:"Club Street", lat:1.28120, lng:103.84590, radius:28,
      arrivalText:"The clan associations and social clubs sat up this slope, above the noise of the trading streets.",
      tasks: [
        { id:"t-clb-01", type:"multiple_choice", prompt:"Why were the clubs built up this slope?", options:["Cheaper land", "Away from the noise of the trading streets", "Closer to the harbour", "Better drainage"], answer:1, hint:"Listen to the street below." },
        { id:"t-clb-02", type:"text", prompt:"Name one kind of association that met on this street.", accept:["clan association", "clan associations", "clan", "social club", "social clubs", "club"], hint:"It's in the arrival text." }
      ] },
    { id:"ann-siang-hill", name:"Ann Siang Hill", lat:1.28050, lng:103.84600, radius:28,
      arrivalText:"Once a nutmeg and clove plantation, later the address of letter-writers and remittance houses.",
      tasks: [
        { id:"t-ash-01", type:"multiple_choice", prompt:"What grew on Ann Siang Hill before the shophouses?", options:["Rubber", "Pepper and gambier", "Nutmeg and cloves", "Sugar cane"], answer:2, hint:"Two spices." },
        { id:"t-ash-02", type:"text", prompt:"Letter-writers here helped workers send what home?", accept:["remittances", "remittance", "money", "letters", "letters and money"], hint:"Think of remittance houses." }
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

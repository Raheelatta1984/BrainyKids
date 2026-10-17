export type Track = "early" | "selective" | "naplan";

export type QuestionTemplateKey =
  | "addition"
  | "subtraction"
  | "multiplication"
  | "division"
  | "sequence"
  | "shape"
  | "perimeter"
  | "area"
  | "fraction"
  | "percentage"
  | "ratio"
  | "average"
  | "spelling"
  | "money"
  | "linear-equation"
  | "quadratic"
  | "gradient"
  | "pythagoras"
  | "ohms-law"
  | "molar-mass"
  | "differentiate"
  | "integrate"
  | "logarithm"
  | "kinematics"
  | "probability";

export type Question = {
  id: string;
  level: 1 | 2 | 3;
  track: Track;
  topic: string;
  question: string;
  // Emoji or short text shown as the visual for the question.
  visual: string;
  choices: string[];
  answer: string;
  explain: string;
  /** Translation template and interpolated values for generated, curriculum-aware questions. */
  templateKey?: QuestionTemplateKey;
  templateValues?: Record<string, string | number>;
  issuedAt?: number;
};

// Original practice questions written in the style of selective and NAPLAN-style tests.
// They are not copies of official past papers.
export const QUESTIONS: Question[] = [
  // Early track (age 4 and under)
  { id: "e1", level: 1, track: "early", topic: "Counting", question: "How many apples are there?", visual: "🍎🍎🍎", choices: ["2", "3", "4"], answer: "3", explain: "Count them one by one: 1, 2, 3. There are 3 apples." },
  { id: "e2", level: 1, track: "early", topic: "Colours", question: "Which one is red?", visual: "🔴🔵🟢", choices: ["Blue", "Red", "Green"], answer: "Red", explain: "The red circle is the one in the middle." },
  { id: "e3", level: 1, track: "early", topic: "Shapes", question: "Which shape is round?", visual: "⭕🔺⬛", choices: ["Square", "Circle", "Triangle"], answer: "Circle", explain: "A circle has no corners and is round all the way around." },
  { id: "e4", level: 1, track: "early", topic: "Animals", question: "What sound does a cow make?", visual: "🐄", choices: ["Moo", "Woof", "Quack"], answer: "Moo", explain: "Cows say moo." },
  { id: "e5", level: 2, track: "early", topic: "Adding", question: "1 + 2 = ?", visual: "🍌 + 🍌🍌", choices: ["2", "3", "4"], answer: "3", explain: "One banana and two bananas make three bananas." },
  { id: "e6", level: 2, track: "early", topic: "Animals", question: "Which animal lives in water?", visual: "🐟🐶🐴", choices: ["Dog", "Fish", "Horse"], answer: "Fish", explain: "Fish live in water and breathe with gills." },
  { id: "e7", level: 2, track: "early", topic: "Sizes", question: "Which is bigger?", visual: "🐘🐭", choices: ["Mouse", "Elephant"], answer: "Elephant", explain: "An elephant is much bigger than a mouse." },

  // Selective-style (maths and reasoning)
  { id: "s1", level: 1, track: "selective", topic: "Maths", question: "What is 7 × 6?", visual: "✖️", choices: ["36", "42", "48", "54"], answer: "42", explain: "7 groups of 6 is 42." },
  { id: "s2", level: 1, track: "selective", topic: "Patterns", question: "What comes next: 2, 4, 8, 16, ___?", visual: "🔢", choices: ["18", "20", "24", "32"], answer: "32", explain: "Each number is doubled: 16 × 2 = 32." },
  { id: "s3", level: 1, track: "selective", topic: "Money", question: "A pencil costs 35 cents. How much do 3 pencils cost?", visual: "✏️✏️✏️", choices: ["85 cents", "95 cents", "105 cents", "115 cents"], answer: "105 cents", explain: "35 × 3 = 105 cents." },
  { id: "s4", level: 1, track: "selective", topic: "Vocabulary", question: "Which word means the same as 'brave'?", visual: "🦸", choices: ["Timid", "Fearless", "Lazy", "Quiet"], answer: "Fearless", explain: "A brave person is fearless, which means not afraid." },
  { id: "s5", level: 2, track: "selective", topic: "Algebra", question: "If 3x + 5 = 20, what is x?", visual: "🧮", choices: ["3", "5", "15", "25"], answer: "5", explain: "3x = 20 − 5 = 15, so x = 15 ÷ 3 = 5." },
  { id: "s6", level: 2, track: "selective", topic: "Area", question: "A rectangle is 12 cm long and 5 cm wide. What is its area?", visual: "📐", choices: ["17 cm²", "24 cm²", "34 cm²", "60 cm²"], answer: "60 cm²", explain: "Area = length × width = 12 × 5 = 60 cm²." },
  { id: "s7", level: 2, track: "selective", topic: "Number sense", question: "Which is the odd one out: 9, 16, 25, 30, 49?", visual: "🔍", choices: ["9", "16", "30", "49"], answer: "30", explain: "9, 16, 25 and 49 are all square numbers. 30 is not." },
  { id: "s8", level: 2, track: "selective", topic: "Analogies", question: "Hot is to cold as light is to ___.", visual: "💡", choices: ["Heavy", "Dark", "Bright", "Loud"], answer: "Dark", explain: "Hot and cold are opposites, and so are light and dark." },
  { id: "s9", level: 3, track: "selective", topic: "Percentages", question: "What is 15% of 240?", visual: "%", choices: ["24", "30", "36", "40"], answer: "36", explain: "10% of 240 is 24 and 5% is 12. Together 24 + 12 = 36." },
  { id: "s10", level: 3, track: "selective", topic: "Speed", question: "A train travels 180 km in 2.5 hours. What is its average speed in km/h?", visual: "🚆", choices: ["60", "72", "75", "90"], answer: "72", explain: "Speed = distance ÷ time = 180 ÷ 2.5 = 72 km/h." },
  { id: "s11", level: 3, track: "selective", topic: "Vocabulary", question: "Which word is the opposite of 'ancient'?", visual: "🏛️", choices: ["Old", "Modern", "Aged", "Historic"], answer: "Modern", explain: "Ancient means very old, and modern means recent." },
  { id: "s12", level: 3, track: "selective", topic: "Geometry", question: "What do the three interior angles of a triangle add up to?", visual: "🔺", choices: ["90°", "180°", "270°", "360°"], answer: "180°", explain: "The interior angles of every triangle add up to 180°." },

  // NAPLAN-style (reading, writing, numeracy, grammar)
  { id: "n1", level: 1, track: "naplan", topic: "Spelling", question: "Which word is spelled correctly?", visual: "✏️", choices: ["Recieve", "Receive", "Receeve", "Receve"], answer: "Receive", explain: "Remember 'i before e, except after c': re-CEIVE." },
  { id: "n2", level: 1, track: "naplan", topic: "Reading", question: "Mia went to the park with her dog. The dog ran fast. Who ran fast?", visual: "📖", choices: ["Mia", "The dog", "Mia's mother", "The park"], answer: "The dog", explain: "The text says 'The dog ran fast.'" },
  { id: "n3", level: 1, track: "naplan", topic: "Division", question: "What is 480 ÷ 8?", visual: "➗", choices: ["50", "60", "70", "80"], answer: "60", explain: "8 × 60 = 480." },
  { id: "n4", level: 1, track: "naplan", topic: "Sentence endings", question: "After the storm, the sky became ___.", visual: "⛅", choices: ["loud", "clear", "hungry", "sleepy"], answer: "clear", explain: "After a storm the sky clears, so 'clear' fits best." },
  { id: "n5", level: 2, track: "naplan", topic: "Grammar", question: "Which word is a noun?", visual: "🌳", choices: ["run", "happy", "garden", "quickly"], answer: "garden", explain: "A noun names a place, person, animal or thing. A garden is a place." },
  { id: "n6", level: 2, track: "naplan", topic: "Fractions", question: "1/2 is the same as ___/8.", visual: "🍕", choices: ["2", "3", "4", "6"], answer: "4", explain: "Multiply the top and bottom by 4: 1/2 = 4/8." },
  { id: "n7", level: 2, track: "naplan", topic: "Punctuation", question: "Which mark ends a question: 'Can we go to the beach ___'", visual: "❓", choices: ["?", ".", "!", ","], answer: "?", explain: "Questions end with a question mark." },
  { id: "n8", level: 2, track: "naplan", topic: "Subtraction", question: "A shop has 45 apples and sells 18. How many are left?", visual: "🍎", choices: ["23", "27", "33", "63"], answer: "27", explain: "45 − 18 = 27." },
  { id: "n9", level: 3, track: "naplan", topic: "Vocabulary", question: "The scientist's results were ___ after she repeated the test.", visual: "🧪", choices: ["consistent", "careless", "hungry", "tiny"], answer: "consistent", explain: "Repeating a test and getting the same results means they were consistent." },
  { id: "n10", level: 3, track: "naplan", topic: "Fractions", question: "A bag has 4 red, 3 blue and 5 green marbles. What fraction are blue?", visual: "🔵", choices: ["1/3", "1/4", "3/4", "1/5"], answer: "1/4", explain: "There are 12 marbles in total. 3 of 12 are blue, which is 3/12 = 1/4." },
  { id: "n11", level: 3, track: "naplan", topic: "Synonyms", question: "Which word means the same as 'rapid'?", visual: "⚡", choices: ["Slow", "Quick", "Heavy", "Quiet"], answer: "Quick", explain: "Rapid and quick both mean fast." },
  { id: "n12", level: 3, track: "naplan", topic: "Perimeter", question: "What is the perimeter of a square with sides of 7 cm?", visual: "⬜", choices: ["14 cm", "21 cm", "28 cm", "49 cm"], answer: "28 cm", explain: "A square has 4 equal sides: 4 × 7 = 28 cm." },
];

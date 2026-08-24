// The nutrient vocabulary, vendored from the `mealtime-nutrients` package,
// version 0.1.0, which is the single source of truth for the five mealtime
// tools. The body below is that package's `nutrients.json` pasted verbatim, so
// `diff` against it is meaningful; JSON is a subset of a JS object literal, so
// the quoted keys are the file's own and not a transcription.
//
// It is a module rather than the JSON file itself because a JSON module import
// is fetched under `connect-src`, which index.html's `default-src 'none'`
// blocks. A module is `script-src 'self'`, which the page already allows. Plate
// has no bundler to inline it and cannot fetch it at runtime, so a committed
// copy is the only delivery left.
//
// To update: regenerate upstream with `python -m mealtime_nutrients.generate_json`,
// paste the file's contents below, and run `npm test`.

export const VOCABULARY =
{
  "unit": "g",
  "energyUnit": "kcal",
  "energyNutrient": "kcal",
  "coreNutrients": ["kcal", "protein", "fat", "carbs"],
  "nutrients": [
    "biotin",
    "caffeine",
    "calcium",
    "carbs",
    "chloride",
    "cholesterol",
    "chromium",
    "copper",
    "fat",
    "fiber",
    "folate",
    "folic_acid",
    "iodine",
    "iron",
    "kcal",
    "magnesium",
    "manganese",
    "molybdenum",
    "monounsaturated_fat",
    "niacin",
    "pantothenic_acid",
    "phosphorus",
    "polyunsaturated_fat",
    "potassium",
    "protein",
    "riboflavin",
    "saturated_fat",
    "selenium",
    "sodium",
    "sugar",
    "thiamin",
    "trans_fat",
    "unsaturated_fat",
    "vitamin_a",
    "vitamin_b12",
    "vitamin_b6",
    "vitamin_c",
    "vitamin_d",
    "vitamin_e",
    "vitamin_k",
    "zinc"
  ],
  "apiNutrients": {
    "biotin": "BIOTIN",
    "caffeine": "CAFFEINE",
    "calcium": "CALCIUM",
    "chloride": "CHLORIDE",
    "cholesterol": "CHOLESTEROL",
    "chromium": "CHROMIUM",
    "copper": "COPPER",
    "fiber": "DIETARY_FIBER",
    "folate": "FOLATE",
    "folic_acid": "FOLIC_ACID",
    "iodine": "IODINE",
    "iron": "IRON",
    "magnesium": "MAGNESIUM",
    "manganese": "MANGANESE",
    "molybdenum": "MOLYBDENUM",
    "monounsaturated_fat": "MONOUNSATURATED_FAT",
    "niacin": "NIACIN",
    "pantothenic_acid": "PANTOTHENIC_ACID",
    "phosphorus": "PHOSPHORUS",
    "polyunsaturated_fat": "POLYUNSATURATED_FAT",
    "potassium": "POTASSIUM",
    "protein": "PROTEIN",
    "riboflavin": "RIBOFLAVIN",
    "saturated_fat": "SATURATED_FAT",
    "selenium": "SELENIUM",
    "sodium": "SODIUM",
    "sugar": "SUGAR",
    "thiamin": "THIAMIN",
    "trans_fat": "TRANS_FAT",
    "unsaturated_fat": "UNSATURATED_FAT",
    "vitamin_a": "VITAMIN_A",
    "vitamin_b12": "VITAMIN_B12",
    "vitamin_b6": "VITAMIN_B6",
    "vitamin_c": "VITAMIN_C",
    "vitamin_d": "VITAMIN_D",
    "vitamin_e": "VITAMIN_E",
    "vitamin_k": "VITAMIN_K",
    "zinc": "ZINC"
  },
  "apiFields": {
    "carbs": "totalCarbohydrate",
    "fat": "totalFat",
    "kcal": "energy"
  }
};

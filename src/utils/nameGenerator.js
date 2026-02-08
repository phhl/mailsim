const FEMALE_NAME_GROUPS = [
  {
    key: 'de',
    weight: 0.45,
    names: [
      'Marie', 'Sophie', 'Maria', 'Anna', 'Lea', 'Laura', 'Lena', 'Katharina',
      'Johanna', 'Leonie', 'Julia', 'Emily', 'Hannah', 'Mia', 'Emma', 'Sarah',
      'Lisa', 'Lara', 'Nina', 'Paula', 'Luisa', 'Clara', 'Emilia', 'Charlotte',
      'Greta', 'Franziska', 'Isabel', 'Pauline'
    ]
  },
  {
    key: 'tr',
    weight: 0.12,
    names: [
      'Aylin', 'Elif', 'Zeynep', 'Fatma', 'Hatice', 'Merve', 'Esra', 'Selin',
      'Leyla', 'Yasemin'
    ]
  },
  {
    key: 'ar',
    weight: 0.08,
    names: ['Layla', 'Noor', 'Fatima', 'Mariam', 'Lina', 'Rasha', 'Huda', 'Aisha']
  },
  {
    key: 'ua-ru',
    weight: 0.12,
    names: [
      'Iryna', 'Oksana', 'Olena', 'Kateryna', 'Sofia', 'Maria', 'Olga',
      'Anastasia', 'Natalia'
    ]
  },
  {
    key: 'pl',
    weight: 0.08,
    names: ['Agnieszka', 'Katarzyna', 'Joanna', 'Magdalena', 'Aneta', 'Ewa']
  },
  {
    key: 'ro',
    weight: 0.08,
    names: ['Andreea', 'Ioana', 'Ramona', 'Mihaela', 'Elena']
  },
  {
    key: 'balkan',
    weight: 0.04,
    names: ['Ivana', 'Marija', 'Jelena', 'Milica']
  },
  {
    key: 'south-eu',
    weight: 0.03,
    names: ['Giulia', 'Carmen', 'Sara', 'Elena', 'Sofia']
  }
];

const MALE_NAME_GROUPS = [
  {
    key: 'de',
    weight: 0.45,
    names: [
      'Maximilian', 'Alexander', 'Paul', 'Leon', 'Lukas', 'Luca', 'Felix',
      'Jonas', 'Tim', 'David', 'Elias', 'Ben', 'Jan', 'Leonard', 'Max',
      'Moritz', 'Florian', 'Sebastian', 'Tobias', 'Philipp', 'Johannes',
      'Martin', 'Thomas', 'Noah', 'Emil', 'Henry', 'Louis', 'Jakob'
    ]
  },
  {
    key: 'tr',
    weight: 0.12,
    names: [
      'Mehmet', 'Mustafa', 'Ahmet', 'Ali', 'Murat', 'Yusuf', 'Omer', 'Emir',
      'Can', 'Kerem'
    ]
  },
  {
    key: 'ar',
    weight: 0.08,
    names: ['Ahmad', 'Omar', 'Hassan', 'Khaled', 'Rami', 'Sami', 'Fadi', 'Ibrahim']
  },
  {
    key: 'ua-ru',
    weight: 0.12,
    names: [
      'Dmytro', 'Oleksii', 'Taras', 'Andriy', 'Mykola', 'Serhii',
      'Ivan', 'Alexey', 'Dmitry'
    ]
  },
  {
    key: 'pl',
    weight: 0.08,
    names: ['Krzysztof', 'Mateusz', 'Jakub', 'Piotr', 'Pawel', 'Tomasz']
  },
  {
    key: 'ro',
    weight: 0.08,
    names: ['Andrei', 'Bogdan', 'Mihai', 'Stefan', 'Adrian']
  },
  {
    key: 'balkan',
    weight: 0.04,
    names: ['Nikola', 'Marko', 'Goran', 'Luka']
  },
  {
    key: 'south-eu',
    weight: 0.03,
    names: ['Marco', 'Antonio', 'Jose', 'Miguel', 'Carlos']
  }
];

const UNISEX_FIRST_NAMES = ['Alex', 'Kim', 'Sasha', 'Nika', 'Mika', 'Ariel', 'Sam'];

const LAST_NAME_GROUPS = [
  {
    key: 'de',
    weight: 0.45,
    names: [
      'Mueller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner',
      'Becker', 'Hoffmann', 'Schulz', 'Koch', 'Richter', 'Klein', 'Wolf',
      'Neumann', 'Schwarz', 'Zimmermann', 'Schaefer', 'Koenig', 'Weiss',
      'Jaeger', 'Krueger', 'Hoffmann', 'Schulze', 'Brandt', 'Hartmann',
      'Schroeder', 'Vogel', 'Peters', 'Keller'
    ]
  },
  {
    key: 'tr',
    weight: 0.12,
    names: [
      'Yilmaz', 'Kaya', 'Demir', 'Sahin', 'Celik', 'Aydin', 'Arslan', 'Ozdemir',
      'Dogan', 'Koc', 'Kurt', 'Aksoy'
    ]
  },
  {
    key: 'ar',
    weight: 0.08,
    names: [
      'Al-Khalil', 'Haddad', 'Nasser', 'Hussein', 'Salim', 'Najjar',
      'Mansour', 'Darwish', 'Khalil', 'Abbas'
    ]
  },
  {
    key: 'ua-ru',
    weight: 0.12,
    names: [
      'Ivanov', 'Petrov', 'Smirnov', 'Kuznetsov', 'Popov', 'Sokolov',
      'Shevchenko', 'Kovalenko', 'Bondarenko', 'Melnyk', 'Moroz', 'Volkov'
    ]
  },
  {
    key: 'pl',
    weight: 0.1,
    names: [
      'Nowak', 'Kowalski', 'Wisniewski', 'Wozniak', 'Kaminski',
      'Lewandowski', 'Zielinski', 'Szymanski', 'Wojcik', 'Dabrowski'
    ]
  },
  {
    key: 'ro',
    weight: 0.06,
    names: ['Popescu', 'Ionescu', 'Stan', 'Dumitrescu', 'Stoica', 'Radu']
  },
  {
    key: 'balkan',
    weight: 0.07,
    names: ['Dimitrov', 'Georgiev', 'Nikolov', 'Todorov', 'Stoyanov', 'Kovac', 'Petrovic', 'Jovanovic']
  },
  {
    key: 'south-eu',
    weight: 0.07,
    names: ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Garcia', 'Gonzalez', 'Martinez']
  },
  {
    key: 'other',
    weight: 0.03,
    names: ['Papadopoulos', 'Nikolaidis', 'Konstantinou', 'Nguyen']
  }
];

const REGION_KEYS = Array.from(
  new Set([
    ...FEMALE_NAME_GROUPS.map((g) => g.key),
    ...MALE_NAME_GROUPS.map((g) => g.key),
    ...LAST_NAME_GROUPS.map((g) => g.key)
  ])
);

const FEMALE_NAMES_BY_REGION = new Map(FEMALE_NAME_GROUPS.map((g) => [g.key, g.names.slice()]));
const MALE_NAMES_BY_REGION = new Map(MALE_NAME_GROUPS.map((g) => [g.key, g.names.slice()]));
const LAST_NAMES_BY_REGION = new Map(LAST_NAME_GROUPS.map((g) => [g.key, g.names.slice()]));

const FEMALE_NAME_LOOKUP = new Map();
const MALE_NAME_LOOKUP = new Map();
const LAST_NAME_LOOKUP = new Map();
const UNISEX_NAME_SET = new Set(UNISEX_FIRST_NAMES.map((n) => n.toLowerCase()));

const addLookup = (map, name, key) => {
  const lower = name.toLowerCase();
  if (!map.has(lower)) map.set(lower, new Set());
  map.get(lower).add(key);
};

FEMALE_NAME_GROUPS.forEach((g) => g.names.forEach((name) => addLookup(FEMALE_NAME_LOOKUP, name, g.key)));
MALE_NAME_GROUPS.forEach((g) => g.names.forEach((name) => addLookup(MALE_NAME_LOOKUP, name, g.key)));
LAST_NAME_GROUPS.forEach((g) => g.names.forEach((name) => addLookup(LAST_NAME_LOOKUP, name, g.key)));

const getRegionDefaults = () => {
  const map = {};
  const total = LAST_NAME_GROUPS.reduce((sum, g) => sum + (g.weight || 0), 0);
  for (const g of LAST_NAME_GROUPS) {
    map[g.key] = total ? (g.weight || 0) / total : 0;
  }
  return map;
};

const getRegionKeys = () => REGION_KEYS.slice();

const getFirstNamesByRegion = (gender, regionKey) => {
  if (gender === 'female') return FEMALE_NAMES_BY_REGION.get(regionKey) || [];
  if (gender === 'male') return MALE_NAMES_BY_REGION.get(regionKey) || [];
  return UNISEX_FIRST_NAMES.slice();
};

const getLastNamesByRegion = (regionKey) => LAST_NAMES_BY_REGION.get(regionKey) || [];

const getAllFirstNamesForRegion = (regionKey) => {
  const female = FEMALE_NAMES_BY_REGION.get(regionKey) || [];
  const male = MALE_NAMES_BY_REGION.get(regionKey) || [];
  return [...female, ...male, ...UNISEX_FIRST_NAMES];
};

const normalizeWeights = (weights, keys) => {
  const normalized = {};
  const total = keys.reduce((sum, key) => sum + Math.max(0, Number(weights[key] || 0)), 0);
  if (!total) {
    const equal = keys.length ? 1 / keys.length : 0;
    keys.forEach((key) => { normalized[key] = equal; });
    return normalized;
  }
  keys.forEach((key) => {
    normalized[key] = Math.max(0, Number(weights[key] || 0)) / total;
  });
  return normalized;
};

const distributeByWeights = (keys, weights, count) => {
  const normalized = normalizeWeights(weights, keys);
  const raw = keys.map((key) => ({ key, value: normalized[key] * count }));
  const floored = raw.map((r) => ({ key: r.key, value: Math.floor(r.value), frac: r.value - Math.floor(r.value) }));
  let used = floored.reduce((sum, r) => sum + r.value, 0);
  let remaining = Math.max(0, count - used);
  floored.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < remaining; i += 1) {
    floored[i % floored.length].value += 1;
  }
  const list = [];
  floored.forEach((r) => {
    for (let i = 0; i < r.value; i += 1) list.push(r.key);
  });
  return shuffle(list);
};

const { randomBytes } = require('crypto');

const DEFAULT_TIMEOUT_MS = 3500;

const pick = (list) => list[Math.floor(Math.random() * list.length)];

const TRANSLIT_MAP = {
  Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss',
  Æ: 'Ae', æ: 'ae', Ø: 'O', ø: 'o', Å: 'A', å: 'a',
  А: 'A', а: 'a', Б: 'B', б: 'b', В: 'V', в: 'v', Г: 'G', г: 'g',
  Д: 'D', д: 'd', Е: 'E', е: 'e', Ё: 'Yo', ё: 'yo', Ж: 'Zh', ж: 'zh',
  З: 'Z', з: 'z', И: 'I', и: 'i', Й: 'Y', й: 'y', К: 'K', к: 'k',
  Л: 'L', л: 'l', М: 'M', м: 'm', Н: 'N', н: 'n', О: 'O', о: 'o',
  П: 'P', п: 'p', Р: 'R', р: 'r', С: 'S', с: 's', Т: 'T', т: 't',
  У: 'U', у: 'u', Ф: 'F', ф: 'f', Х: 'Kh', х: 'kh', Ц: 'Ts', ц: 'ts',
  Ч: 'Ch', ч: 'ch', Ш: 'Sh', ш: 'sh', Щ: 'Shch', щ: 'shch',
  Ы: 'Y', ы: 'y', Э: 'E', э: 'e', Ю: 'Yu', ю: 'yu', Я: 'Ya', я: 'ya',
  Ь: '', ь: '', Ъ: '', ъ: '',
  І: 'I', і: 'i', Ї: 'Yi', ї: 'yi', Є: 'Ye', є: 'ye', Ґ: 'G', ґ: 'g',
  ا: 'a', أ: 'a', إ: 'i', آ: 'a', ب: 'b', ت: 't', ث: 'th', ج: 'j',
  ح: 'h', خ: 'kh', د: 'd', ذ: 'dh', ر: 'r', ز: 'z', س: 's',
  ش: 'sh', ص: 's', ض: 'd', ط: 't', ظ: 'z', ع: 'a', غ: 'gh',
  ف: 'f', ق: 'q', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h',
  و: 'w', ي: 'y', ة: 'a', ى: 'a'
};

const transliterate = (value) => {
  const raw = String(value || '');
  let out = '';
  for (const ch of raw) {
    if (Object.prototype.hasOwnProperty.call(TRANSLIT_MAP, ch)) {
      out += TRANSLIT_MAP[ch];
    } else {
      out += ch;
    }
  }
  return out.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
};

const slugifyUsername = (value) => {
  return transliterate(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.+/g, '.');
};

const buildBaseUsername = ({ firstName, lastName, prefix }) => {
  const base = [prefix, firstName, lastName].filter(Boolean).join('.');
  return slugifyUsername(base) || 'student';
};

const makeUnique = (base, existing) => {
  if (!existing.has(base)) {
    existing.add(base);
    return base;
  }

  let counter = 2;
  let candidate = `${base}${counter}`;
  while (existing.has(candidate)) {
    counter += 1;
    candidate = `${base}${counter}`;
  }
  existing.add(candidate);
  return candidate;
};

const toNameKey = (firstName, lastName) => {
  return `${String(firstName || '').trim().toLowerCase()}|${String(lastName || '').trim().toLowerCase()}`;
};

const shuffle = (list) => {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

const weightedPick = (groups) => {
  const total = groups.reduce((sum, g) => sum + (g.weight || 0), 0);
  const target = Math.random() * (total || 1);
  let acc = 0;
  for (const g of groups) {
    acc += g.weight || 0;
    if (target <= acc) return g;
  }
  return groups[groups.length - 1];
};

const pickFromGroups = (groups) => {
  const group = weightedPick(groups);
  return pick(group.names || []);
};

const pickLastName = () => pickFromGroups(LAST_NAME_GROUPS);

const normalizeGenderWeights = (weights) => {
  const female = Math.max(0, Number(weights?.female ?? 0));
  const male = Math.max(0, Number(weights?.male ?? 0));
  const unisex = Math.max(0, Number(weights?.unisex ?? 0));
  const total = female + male + unisex;
  if (!total) return null;
  return {
    female: female / total,
    male: male / total,
    unisex: unisex / total
  };
};

const buildLocalNames = (count, { excludeKeys, genderMix, genderWeights } = {}) => {
  const seen = excludeKeys || new Set();
  const names = [];
  const attemptsPerName = 40;

  const wantFemale = Math.max(0, Math.min(Number(genderMix?.femaleCount || 0), count));
  const wantMale = Math.max(0, Math.min(Number(genderMix?.maleCount || 0), count));
  const wantUnisex = Math.max(0, Math.min(Number(genderMix?.unisexCount || 0), count));
  const capFemale = Math.max(0, Math.min(wantFemale, count));
  const capMale = Math.max(0, Math.min(wantMale, count - capFemale));
  const capUnisex = Math.max(0, Math.min(wantUnisex, count - capFemale - capMale));

  const normalized = normalizeGenderWeights(genderWeights);
  const defaultGenderWeights = normalized
    ? [
        { key: 'female', weight: normalized.female },
        { key: 'male', weight: normalized.male },
        { key: 'unisex', weight: normalized.unisex }
      ]
    : [
        { key: 'female', weight: 0.48 },
        { key: 'male', weight: 0.47 },
        { key: 'unisex', weight: 0.05 }
      ];

  const pickGender = () => {
    const total = defaultGenderWeights.reduce((sum, g) => sum + g.weight, 0);
    const target = Math.random() * total;
    let acc = 0;
    for (const g of defaultGenderWeights) {
      acc += g.weight;
      if (target <= acc) return g.key;
    }
    return 'female';
  };

  const pickFirstName = (gender) => {
    if (gender === 'female') return pickFromGroups(FEMALE_NAME_GROUPS);
    if (gender === 'male') return pickFromGroups(MALE_NAME_GROUPS);
    return pick(UNISEX_FIRST_NAMES);
  };

  const addName = (gender) => {
    for (let attempt = 0; attempt < attemptsPerName; attempt += 1) {
      const firstName = pickFirstName(gender);
      const lastName = pickLastName();
      const key = toNameKey(firstName, lastName);
      if (seen.has(key)) continue;
      seen.add(key);
      names.push({ firstName, lastName });
      return true;
    }
    return false;
  };

  for (let i = 0; i < capFemale; i += 1) addName('female');
  for (let i = 0; i < capMale; i += 1) addName('male');
  for (let i = 0; i < capUnisex; i += 1) addName('unisex');

  const remaining = count - names.length;
  for (let i = 0; i < remaining; i += 1) {
    const gender = pickGender();
    if (!addName(gender)) {
      const fallbackFirst = pickFromGroups(FEMALE_NAME_GROUPS) || pickFromGroups(MALE_NAME_GROUPS) || 'Student';
      const fallbackLast = pickLastName() || '';
      names.push({ firstName: fallbackFirst, lastName: fallbackLast });
    }
  }

  return names.slice(0, count);
};

const fetchApiNames = async (count, { apiUrl, apiNat, timeoutMs } = {}) => {
  if (!apiUrl) return [];

  const url = new URL(apiUrl);
  url.searchParams.set('results', String(count));
  if (apiNat) url.searchParams.set('nat', apiNat);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    url.searchParams.set('cb', randomBytes(6).toString('hex'));
    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { 'cache-control': 'no-store' }
    });
    if (!res.ok) throw new Error(`Name API failed: ${res.status}`);
    const data = await res.json();
    return (data.results || []).map((row) => ({
      firstName: row?.name?.first,
      lastName: row?.name?.last,
      gender: row?.gender
    })).filter((row) => row.firstName || row.lastName);
  } finally {
    clearTimeout(timeout);
  }
};

const getNameBatch = async (count, { useApi, apiUrl, apiNat, timeoutMs, genderMix, genderWeights } = {}) => {
  if (!useApi) return buildLocalNames(count, { genderMix, genderWeights });
  try {
    const apiNames = await fetchApiNames(count, { apiUrl, apiNat, timeoutMs });
    const uniqueApi = [];
    const seen = new Set();

    for (const row of apiNames) {
      const key = toNameKey(row.firstName, row.lastName);
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueApi.push(row);
      if (uniqueApi.length >= count) break;
    }

    const wantFemale = Math.max(0, Math.min(Number(genderMix?.femaleCount || 0), count));
    const wantMale = Math.max(0, Math.min(Number(genderMix?.maleCount || 0), count));
    const apiFemale = uniqueApi.filter((row) => String(row.gender || '').toLowerCase() === 'female');
    const apiMale = uniqueApi.filter((row) => String(row.gender || '').toLowerCase() === 'male');
    const apiOther = uniqueApi.filter((row) => !row.gender);

    const selected = [];
    selected.push(...apiFemale.slice(0, wantFemale));
    selected.push(...apiMale.slice(0, Math.min(wantMale, count - selected.length)));
    if (selected.length < count) {
      const rest = uniqueApi.filter((row) => !selected.includes(row));
      selected.push(...rest.slice(0, count - selected.length));
    }

    if (selected.length >= count) return selected.slice(0, count);

    const localNames = buildLocalNames(count - selected.length, { excludeKeys: seen, genderMix, genderWeights });
    return selected.concat(localNames).slice(0, count);
  } catch (e) {
    // Fallback to local list when API is unavailable.
  }
  return buildLocalNames(count, { genderMix, genderWeights });
};

const buildUserSeeds = (names, { prefix, existingUsernames }) => {
  return names.map((name) => {
    const firstName = name.firstName || 'Student';
    const lastName = name.lastName || '';
    const displayName = `${firstName}${lastName ? ' ' + lastName : ''}`.trim();
    const base = buildBaseUsername({ firstName, lastName, prefix });
    const username = makeUnique(base, existingUsernames);
    return { username, displayName };
  });
};

const buildUsername = ({ firstName, lastName, prefix }, existingUsernames) => {
  const base = buildBaseUsername({ firstName, lastName, prefix });
  return makeUnique(base, existingUsernames);
};

const generateNameEntries = (config, { existingUsernames } = {}) => {
  const count = Math.max(0, Number(config.count || 0));
  if (!count) return [];
  const selectedRegions = (config.regions || []).filter(Boolean);
  const regionKeys = selectedRegions.length ? selectedRegions : getRegionKeys();
  const genderKeys = ['female', 'male', 'diverse', 'unspecified'];
  const genderWeights = config.genderWeights || {};
  const regionWeights = config.regionWeights || {};

  let genders = [];
  let regionsFirst = [];
  const regionGenderCounts = config.regionGenderCounts || null;
  if (regionGenderCounts) {
    const entries = [];
    Object.keys(regionGenderCounts).forEach((regionKey) => {
      const counts = regionGenderCounts[regionKey] || {};
      genderKeys.forEach((key) => {
        const amount = Math.max(0, Number(counts[key] || 0));
        for (let i = 0; i < amount; i += 1) {
          entries.push({ gender: key, regionFirst: regionKey });
        }
      });
    });
    const limited = entries.slice(0, count);
    genders = limited.map((entry) => entry.gender);
    regionsFirst = limited.map((entry) => entry.regionFirst);
  } else {
    const genderCounts = config.genderCounts || null;
    if (genderCounts) {
      genderKeys.forEach((key) => {
        const amount = Math.max(0, Number(genderCounts[key] || 0));
        for (let i = 0; i < amount; i += 1) genders.push(key);
      });
      const remaining = Math.max(0, count - genders.length);
      if (remaining > 0) {
        genders = genders.concat(distributeByWeights(genderKeys, genderWeights, remaining));
      }
      genders = genders.slice(0, count);
    } else {
      genders = distributeByWeights(genderKeys, genderWeights, count);
    }
    regionsFirst = distributeByWeights(regionKeys, regionWeights, count);
  }
  const regionsLast = config.comboMode === 'mixed'
    ? distributeByWeights(regionKeys, regionWeights, count)
    : regionsFirst.slice();

  const uniqueNames = !!config.uniqueNames;
  const existingNameKeys = new Set();
  const usernames = existingUsernames || new Set();

  const entries = [];
  const attemptsPerEntry = 40;

  for (let i = 0; i < count; i += 1) {
    const gender = genders[i];
    const regionFirst = regionsFirst[i];
    const regionLast = regionsLast[i];

    let firstName = '';
    let lastName = '';
    let attempts = 0;
    while (attempts < attemptsPerEntry) {
      attempts += 1;
      if (gender === 'female') {
        const list = getFirstNamesByRegion('female', regionFirst);
        firstName = list.length ? pick(list) : pick(getAllFirstNamesForRegion(regionFirst));
      } else if (gender === 'male') {
        const list = getFirstNamesByRegion('male', regionFirst);
        firstName = list.length ? pick(list) : pick(getAllFirstNamesForRegion(regionFirst));
      } else if (gender === 'diverse') {
        firstName = pick(UNISEX_FIRST_NAMES);
      } else {
        const pool = getAllFirstNamesForRegion(regionFirst);
        firstName = pool.length ? pick(pool) : pick([...UNISEX_FIRST_NAMES]);
      }

      const lastList = getLastNamesByRegion(regionLast);
      lastName = lastList.length ? pick(lastList) : pick(getLastNamesByRegion(regionKeys[0]) || []);

      const nameKey = toNameKey(firstName, lastName);
      if (!uniqueNames || !existingNameKeys.has(nameKey)) {
        existingNameKeys.add(nameKey);
        break;
      }
    }

    const displayName = `${firstName}${lastName ? ' ' + lastName : ''}`.trim();
    const base = buildBaseUsername({ firstName, lastName, prefix: config.prefix });
    const username = makeUnique(base, usernames);
    const region = regionFirst === regionLast ? regionFirst : 'mixed';
    entries.push({
      index: i + 1,
      firstName,
      lastName,
      gender,
      region,
      regionFirst,
      regionLast,
      displayName,
      username,
      password: config.includePasswords ? (Math.random().toString(36).slice(2, 10) + '!') : ''
    });
  }

  return entries;
};

const validateNameEntry = ({ firstName, lastName, regions, comboMode }) => {
  const regionList = (regions || []).length ? regions : getRegionKeys();
  const firstLower = String(firstName || '').trim().toLowerCase();
  const lastLower = String(lastName || '').trim().toLowerCase();
  if (!firstLower || !lastLower) return { ok: false, error: 'name_required' };

  const findRegion = (lookup) => {
    const regionsForName = lookup.get(firstLower);
    if (!regionsForName) return null;
    for (const key of regionList) {
      if (regionsForName.has(key)) return key;
    }
    return null;
  };

  let gender = null;
  let regionFirst = findRegion(FEMALE_NAME_LOOKUP);
  if (regionFirst) {
    gender = 'female';
  } else {
    regionFirst = findRegion(MALE_NAME_LOOKUP);
    if (regionFirst) gender = 'male';
  }
  if (!gender && UNISEX_NAME_SET.has(firstLower)) {
    gender = 'diverse';
    regionFirst = regionList[0] || null;
  }
  if (!gender) {
    gender = 'diverse';
    regionFirst = regionList[0] || null;
  }

  const regionsForLast = LAST_NAME_LOOKUP.get(lastLower);
  let regionLast = null;
  if (regionsForLast) {
    for (const key of regionList) {
      if (regionsForLast.has(key)) {
        regionLast = key;
        break;
      }
    }
  }
  if (!regionLast) regionLast = regionFirst || regionList[0] || null;

  if (comboMode === 'typical' && regionFirst !== regionLast) {
    return { ok: false, error: 'combo_mismatch' };
  }

  const region = regionFirst === regionLast ? regionFirst : 'mixed';
  return { ok: true, gender, regionFirst, regionLast, region };
};

module.exports = {
  getNameBatch,
  buildUserSeeds,
  buildUsername,
  getRegionDefaults,
  getRegionKeys,
  getFirstNamesByRegion,
  getLastNamesByRegion,
  getAllFirstNamesForRegion,
  generateNameEntries,
  validateNameEntry
};


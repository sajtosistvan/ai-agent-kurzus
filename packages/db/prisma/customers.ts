// customers.ts — 20 kézzel írt, ÉLETSZERŰ ügyfél a csomag-demókhoz. A három régi kód
// (ACME, GLOBEX, INITECH) megmarad kompatibilitásból. A budget szándékosan szórt
// (15e–800e Ft), hogy a "nem fér a keretbe → visszalépés" élőben demózható legyen.

export interface CustomerSeed {
  code: string;
  name: string;
  contact_name: string | null;
  email: string;
  city: string;
  customer_type: 'magánszemély' | 'iroda' | 'étterem' | 'hotel' | 'üzlet';
  budget: number;
  expertise_level: 'kezdő' | 'haladó' | 'profi';
  pet_safe_required: boolean;
  kid_safe_required: boolean;
  notes: string;
}

export const customers: CustomerSeed[] = [
  { code: 'ACME', name: 'ACME Studio Kft.', contact_name: 'Vass Petra', email: 'petra@acmestudio.hu', city: 'Budapest', customer_type: 'iroda', budget: 15000, expertise_level: 'kezdő', pet_safe_required: false, kid_safe_required: false, notes: 'Kis belvárosi iroda, kevés természetes fény; senki nem ér rá öntözni, heti egy locsolás a realitás.' },
  { code: 'GLOBEX', name: 'Globex Hungary Zrt.', contact_name: 'Nagy Bence', email: 'bence.nagy@globex.hu', city: 'Budapest', customer_type: 'iroda', budget: 120000, expertise_level: 'haladó', pet_safe_required: false, kid_safe_required: false, notes: 'Nyitott irodatér nagy üvegfelületekkel, déli fekvés; recepció mellé látványos, nagy növényeket szeretnének.' },
  { code: 'INITECH', name: 'Initech Consulting', contact_name: 'Kovács Márk', email: 'mark.kovacs@initech.hu', city: 'Budaörs', customer_type: 'iroda', budget: 250000, expertise_level: 'profi', pet_safe_required: false, kid_safe_required: false, notes: 'Van irodai "növényfelelős", ritkaságokra is nyitottak; tárgyalónként legalább egy nagy termetű növény kell.' },
  { code: 'ZOLDSAROK', name: 'Zöld Sarok Kávézó', contact_name: 'Tóth Lilla', email: 'hello@zoldsarok.hu', city: 'Szeged', customer_type: 'étterem', budget: 80000, expertise_level: 'kezdő', pet_safe_required: false, kid_safe_required: true, notes: 'Családbarát kávézó, a növények gyerekmagasságban lesznek; párás, meleg tér, sok szórt fénnyel.' },
  { code: 'HOTELDUNA', name: 'Hotel Duna Panoráma', contact_name: 'Szabó Gergő', email: 'gergo.szabo@hotelduna.hu', city: 'Budapest', customer_type: 'hotel', budget: 800000, expertise_level: 'profi', pet_safe_required: false, kid_safe_required: false, notes: 'Lobbi + wellness-részleg; reprezentatív, nagy növények kellenek, saját kertész gondozza őket.' },
  { code: 'KISSCSALAD', name: 'Kiss család', contact_name: 'Kiss Andrea', email: 'andrea.kiss84@gmail.com', city: 'Debrecen', customer_type: 'magánszemély', budget: 35000, expertise_level: 'kezdő', pet_safe_required: true, kid_safe_required: true, notes: 'Két kisgyerek és egy macska; napos nappali, de csak strapabíró, nem mérgező növény jöhet.' },
  { code: 'NOVA', name: 'Nova Fitness', contact_name: 'Balogh Réka', email: 'reka@novafitness.hu', city: 'Győr', customer_type: 'üzlet', budget: 60000, expertise_level: 'kezdő', pet_safe_required: false, kid_safe_required: false, notes: 'Edzőterem magas párával; a recepcióra és az ablakpárkányokra kellenek jól tűrő növények.' },
  { code: 'VERANDA', name: 'Veranda Étterem', contact_name: 'Molnár Dávid', email: 'david@verandaetterem.hu', city: 'Pécs', customer_type: 'étterem', budget: 150000, expertise_level: 'haladó', pet_safe_required: false, kid_safe_required: false, notes: 'Télikert jellegű vendégtér, sok direkt nappal; mediterrán hangulatot szeretnének fűszernövényekkel.' },
  { code: 'PIXELLAB', name: 'PixelLab Digital', contact_name: 'Fekete Zsófi', email: 'zsofi@pixellab.hu', city: 'Budapest', customer_type: 'iroda', budget: 45000, expertise_level: 'kezdő', pet_safe_required: true, kid_safe_required: false, notes: 'Kutyabarát iroda (két iroda-kutya); észak fekvés, árnyékos asztalok — csak pet-safe növény jöhet.' },
  { code: 'HARMONIA', name: 'Harmónia Jógastúdió', contact_name: 'Oláh Eszter', email: 'eszter@harmoniajoga.hu', city: 'Budapest', customer_type: 'üzlet', budget: 40000, expertise_level: 'haladó', pet_safe_required: true, kid_safe_required: true, notes: 'Nyugodt, természetes tér; légtisztító növényeket kérnek, a termekben tompított fény van.' },
  { code: 'SARKANY', name: 'Sárkány Bisztró', contact_name: 'Varga Tamás', email: 'tamas@sarkanybisztro.hu', city: 'Miskolc', customer_type: 'étterem', budget: 25000, expertise_level: 'kezdő', pet_safe_required: false, kid_safe_required: false, notes: 'Kis bisztró, szűk keret; pár mutatós, de olcsó és igénytelen növény az ablakba.' },
  { code: 'GRANIT', name: 'Gránit Ügyvédi Iroda', contact_name: 'dr. Papp Ilona', email: 'ilona.papp@granitlegal.hu', city: 'Budapest', customer_type: 'iroda', budget: 180000, expertise_level: 'haladó', pet_safe_required: false, kid_safe_required: false, notes: 'Elegáns, konzervatív enteriőr; formára nyírható / szobrászi megjelenésű növényeket keresnek.' },
  { code: 'BABAKUCKO', name: 'Babakuckó Bölcsőde', contact_name: 'Horváth Kata', email: 'kata@babakucko.hu', city: 'Kecskemét', customer_type: 'üzlet', budget: 30000, expertise_level: 'kezdő', pet_safe_required: false, kid_safe_required: true, notes: 'Bölcsőde — KIZÁRÓLAG gyerekbiztos növény jöhet, magas polcra is csak nem mérgező kerülhet.' },
  { code: 'SKYLINE', name: 'Skyline Coworking', contact_name: 'Lukács Ádám', email: 'adam@skylinecw.hu', city: 'Budapest', customer_type: 'iroda', budget: 220000, expertise_level: 'haladó', pet_safe_required: true, kid_safe_required: false, notes: 'Ötszintes coworking, szintenként más fényviszony; állatbarát ház, gurulós kaspókat terveznek.' },
  { code: 'RETROMOZI', name: 'Retro Mozi & Kávézó', contact_name: 'Simon Petra', email: 'petra@retromozi.hu', city: 'Szombathely', customer_type: 'étterem', budget: 55000, expertise_level: 'kezdő', pet_safe_required: false, kid_safe_required: false, notes: 'Sötét előtér, alig van természetes fény — csak árnyéktűrő növény életképes itt.' },
  { code: 'TOTHKERT', name: 'Tóth Bernadett', contact_name: null, email: 'bernadett.toth@freemail.hu', city: 'Eger', customer_type: 'magánszemély', budget: 90000, expertise_level: 'profi', pet_safe_required: false, kid_safe_required: false, notes: 'Gyűjtő: ritka filodendronokat és könnyen szaporítható különlegességeket keres a déli teraszára.' },
  { code: 'MEDIPONT', name: 'MediPont Magánklinika', contact_name: 'dr. Szűcs Gábor', email: 'gabor.szucs@medipont.hu', city: 'Budapest', customer_type: 'iroda', budget: 130000, expertise_level: 'kezdő', pet_safe_required: false, kid_safe_required: true, notes: 'Váró és gyerekorvosi részleg; allergiabarát, nem virágzó, könnyen tisztán tartható növények.' },
  { code: 'LOFT27', name: 'Loft27 Airbnb', contact_name: 'Kerekes Máté', email: 'mate@loft27.hu', city: 'Budapest', customer_type: 'magánszemély', budget: 20000, expertise_level: 'kezdő', pet_safe_required: false, kid_safe_required: false, notes: 'Kiadó lakás — hetekig nem jár ott senki, csak extrém szárazságtűrő növény marad életben.' },
  { code: 'PANORAMA', name: 'Panoráma Étterem', contact_name: 'Bakos Nóra', email: 'nora@panorama-etterem.hu', city: 'Balatonfüred', customer_type: 'étterem', budget: 300000, expertise_level: 'haladó', pet_safe_required: false, kid_safe_required: false, notes: 'Tóra néző terasz + belső tér; nyáron tűző nap, télen fűtött télikert — kétlaki növényállomány kell.' },
  { code: 'GREENDESK', name: 'GreenDesk Iroda', contact_name: 'Sipos Vera', email: 'vera@greendesk.hu', city: 'Veszprém', customer_type: 'iroda', budget: 70000, expertise_level: 'haladó', pet_safe_required: true, kid_safe_required: true, notes: 'Családbarát + kutyabarát iroda; közepes fény, a kollégák beosztásban öntöznek.' },
];

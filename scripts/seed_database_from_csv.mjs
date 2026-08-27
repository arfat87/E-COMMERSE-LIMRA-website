import { createClient } from "@insforge/sdk";

const client = createClient({
  baseUrl: "https://vb9ucr22.us-east.insforge.app",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3OC0xMjM0LTU2NzgtOTBhYi1jZGVmMTIzNDU2NzgiLCJlbWFpbCI6ImFub25AaW5zZm9yZ2UuY29tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNzQ3MjZ9.CORVtgdxoKKq0AhdUN0RY8s1h3jHMUF3ZOB0CpmnoYk"
});

// CSV Raw Data from user
const stockItemsCSV = `id,sku,name,category,unit,qty,min_qty,cost_price,supplier,is_available,updated_at
stk_1785945130881,J136,THUMSUP 1L,Cold Drinks,pcs,0,10,50,,true,2026-08-05T15:52:10.881Z
stk_4,J004,Mustard Oil (মাস্টার অয়েল),Bhusimal & Spices,L,2,1,180,Egra Supplier,true,2026-08-15T13:10:05.581Z
stk_62,J062,Campa White 500ml,Cold Drinks,pcs,71,10,20,Egra Supplier,true,2026-08-15T13:32:17.853Z
stk_133,J00133,thermal copy,Packaging & Carry Bags,pcs,33,10,27.5,Egra Supplier,false,2026-08-05T15:24:33.243Z
stk_1785945217892,J137,STRO,Packaging & Carry Bags,packet,2,1,25,,true,2026-08-05T15:53:37.892Z
stk_134,J00134,plastic FOLK,Packaging & Carry Bags,packet,0,10,0,Egra Supplier,false,2026-08-14T06:40:41.493Z
stk_41,J041,Black Pepper (Gol Morich),Bhusimal & Spices,g,899.45,250,0.78,Egra Supplier,true,2026-08-14T06:44:11.222Z
stk_3,J003,Refined Oil (রেফাইন্ড অয়েল),Bhusimal & Spices,L,0,1,120,Egra Supplier,false,2026-08-15T13:25:43.048Z
stk_1,J001,Rice (রাইস),Bhusimal & Spices,packet,4,2,2574,Egra Supplier,false,2026-08-15T13:25:54.459Z
stk_2,J002,Palm Oil (পাম অয়েল),Bhusimal & Spices,packet,55,20,107,Egra Supplier,true,2026-08-15T16:12:46.655Z
stk_65,J065,Local Mineral Water 1L,Cold Drinks,pcs,0,24,0,Egra Supplier,false,2026-08-04T14:32:01.363Z
stk_66,J066,Kinley Water 500ml,Cold Drinks,pcs,0,24,0,Egra Supplier,false,2026-08-04T14:32:01.363Z
stk_6,J006,Atta (আটা),Bhusimal & Spices,kg,15,5,44,Egra Supplier,true,2026-08-13T15:31:16.653Z
stk_21,J021,Kabuli Chana,Bhusimal & Spices,g,2998.8,500,0.16,Egra Supplier,true,2026-08-15T16:38:51.285Z
stk_38,J038,Starful (Star Anise),Bhusimal & Spices,g,499.82,250,0.78,Egra Supplier,true,2026-08-10T16:05:26.119Z
stk_18,J018,Haldi (Turmeric Powder),Bhusimal & Spices,packet,42,5,12.5,Egra Supplier,true,2026-08-12T15:52:35.810Z
stk_19,J019,Jeera (Cumin Seeds),Bhusimal & Spices,g,2749.7,500,0.23,Egra Supplier,true,2026-08-09T15:49:33.947Z
stk_42,J042,Pure Ghee,Bhusimal & Spices,box,0,1,590,Egra Supplier,true,2026-08-14T17:56:57.822Z
stk_23,J023,Attar / Essence,Bhusimal & Spices,pcs,3,2,46.6,Egra Supplier,true,2026-08-15T13:11:34.270Z
stk_52,J052,Egg (ডিম),Bhusimal & Spices,packet,0,3,200,Egra Supplier,true,2026-08-14T06:40:03.868Z
stk_10,J010,Soy Sauce,Bhusimal & Spices,pcs,3,1,65,Egra Supplier,true,2026-08-11T14:27:57.875Z
stk_9,J009,Chili Sauce,Bhusimal & Spices,pcs,12,2,33.6,Egra Supplier,true,2026-08-11T14:27:45.757Z
stk_34,J034,Elachi (Cardamom),Bhusimal & Spices,g,699.7,250,3.1,Egra Supplier,true,2026-08-15T13:12:00.070Z
stk_43,J043,Baking Powder,Bhusimal & Spices,box,0,1,80,Egra Supplier,true,2026-08-05T17:32:02.903Z
stk_68,J068,Local Mineral Water 500ml,Cold Drinks,pcs,0,24,0,Egra Supplier,false,2026-08-07T16:23:25.504Z
stk_33,J033,Mogoz (Melon Seeds),Bhusimal & Spices,g,399.4,100,0.54,Egra Supplier,true,2026-08-14T08:44:00.654Z
stk_20,J020,Dal (Pulses),Bhusimal & Spices,g,2000,500,0.14,Egra Supplier,true,2026-08-04T15:05:50.945Z
stk_27,J027,Dry Chilli,Bhusimal & Spices,g,1999.55,250,0.3,Egra Supplier,true,2026-08-14T08:43:29.902Z
stk_58,J058,Amul Fresh Cream,Dairy Items,packet,6,2,75,Egra Supplier,true,2026-08-14T13:25:20.344Z
stk_22,J022,Mix Dal,Bhusimal & Spices,g,2000,500,0.1,Egra Supplier,true,2026-08-04T15:07:43.714Z
stk_25,J025,Yellow Food Color,Bhusimal & Spices,box,2,1,85,Egra Supplier,true,2026-08-04T15:08:28.090Z
stk_26,J026,Green Food Color,Bhusimal & Spices,box,2,1,85,Egra Supplier,true,2026-08-04T15:08:40.292Z
stk_12,J012,Corn Flour,Bhusimal & Spices,kg,9,2,62,Egra Supplier,true,2026-08-09T15:48:04.085Z
stk_28,J028,Mouri (Fennel Seeds),Bhusimal & Spices,g,1000,200,0.13,Egra Supplier,true,2026-08-04T15:09:13.970Z
stk_30,J030,Posto (Poppy Seeds),Bhusimal & Spices,packet,6,2,20,Egra Supplier,true,2026-08-14T08:45:48.182Z
stk_37,J037,Dalchini (Cinnamon),Bhusimal & Spices,g,349.8,250,0.28,Egra Supplier,true,2026-08-10T16:05:08.645Z
stk_31,J031,Dalda / Vanaspati,Bhusimal & Spices,packet,8,2,15,Egra Supplier,true,2026-08-14T08:45:25.573Z
stk_32,J032,Kaju (Cashew Nuts),Bhusimal & Spices,g,2000,500,0.6,Egra Supplier,true,2026-08-04T16:10:15.201Z
stk_46,J046,Papad,Bhusimal & Spices,packet,21,5,14,Egra Supplier,true,2026-08-12T16:32:55.589Z
stk_35,J035,Long (Cloves),Bhusimal & Spices,g,119.9,250,0.46,Egra Supplier,true,2026-08-12T15:53:46.361Z
stk_24,J024,Red Food Color,Bhusimal & Spices,box,2,1,85,Egra Supplier,true,2026-08-13T15:44:33.478Z
stk_47,J047,Kissan Tomato Sauce Pouch,Bhusimal & Spices,pcs,179,50,14.5,Egra Supplier,true,2026-08-15T13:25:22.025Z
stk_36,J036,Jaitri (Mace),Bhusimal & Spices,g,449.85,250,2.58,Egra Supplier,true,2026-08-15T13:12:17.222Z
stk_40,J040,Shahi Jeera,Bhusimal & Spices,packet,5,2,230,Egra Supplier,true,2026-08-04T16:16:54.494Z
stk_54,J054,Milk (দুধ),Dairy Items,packet,2,2,30,Egra Supplier,false,2026-08-15T13:30:29.302Z
stk_44,J044,Mushroom,Bhusimal & Spices,box,2,1,145,Egra Supplier,true,2026-08-05T17:32:37.567Z
stk_57,J057,Butter,Dairy Items,packet,0,2,60,Egra Supplier,true,2026-08-15T14:40:40.325Z
stk_45,J045,Green Peas,Bhusimal & Spices,box,0,1,70,Egra Supplier,false,2026-08-04T16:18:55.746Z
stk_17,J017,Chilli Powder,Bhusimal & Spices,packet,51,20,18.75,Egra Supplier,true,2026-08-13T15:44:01.921Z
stk_48,J048,Jaljeera Powder,Bhusimal & Spices,pcs,50,10,0.8,Egra Supplier,false,2026-08-04T16:27:21.586Z
stk_61,J061,Campa Black 500ml,Cold Drinks,pcs,10,10,20,Egra Supplier,false,2026-08-15T13:32:01.322Z
stk_49,J049,Black Salt (Bit Nun),Bhusimal & Spices,kg,2,1,25,Egra Supplier,true,2026-08-04T16:23:39.673Z
stk_50,J050,Regular Salt,Bhusimal & Spices,pcs,25,5,10.4,Egra Supplier,true,2026-08-04T16:24:26.226Z
stk_8,J008,Tomato Sauce (টমেটো sos),Bhusimal & Spices,packet,19,5,33.6,Egra Supplier,true,2026-08-15T13:10:47.860Z
stk_16,J016,Ajinomoto (Ajina),Bhusimal & Spices,kg,5,2,180,Egra Supplier,true,2026-08-14T06:43:20.014Z
stk_29,J029,Sugar,Bhusimal & Spices,g,4702.8,1,52,Egra Supplier,true,2026-08-14T17:56:43.098Z
stk_55,J055,Dahi (দই / Curd),Dairy Items,packet,2,2,80,Egra Supplier,false,2026-08-15T13:30:45.014Z
stk_11,J011,Vinegar,Bhusimal & Spices,pcs,4,2,45,Egra Supplier,true,2026-08-15T13:11:01.141Z
stk_63,J063,Kinley Water 1L,Cold Drinks,pcs,0,24,0,Egra Supplier,false,2026-08-07T12:47:47.612Z
stk_53,J053,Staff Rice,Bhusimal & Spices,kg,10,5,35,Egra Supplier,false,2026-08-05T16:59:22.502Z
stk_15,J015,Kashmiri Chilli Powder,Bhusimal & Spices,pcs,4,1,52,Egra Supplier,true,2026-08-13T15:43:36.191Z
stk_67,J067,Bisleri Water 500ml,Cold Drinks,pcs,23,20,10,Egra Supplier,true,2026-08-14T17:37:40.743Z
stk_59,J059,Cheese Block / Slice,Dairy Items,pcs,8,3,145,Egra Supplier,false,2026-08-04T16:35:16.346Z
stk_51,J051,Dhania (Coriander Seeds),Bhusimal & Spices,g,1499.8,250,0.18,Egra Supplier,true,2026-08-14T06:43:50.838Z
stk_69,J069,Kinley Soda,Cold Drinks,pcs,4,10,20,Egra Supplier,false,2026-08-05T16:27:21.730Z
stk_60,J060,Campa White 100ml,Cold Drinks,pcs,23,10,10,Egra Supplier,true,2026-08-05T17:44:55.800Z
stk_5,J005,Maida (মাইদা),Bhusimal & Spices,kg,19.5,10,36.4,Egra Supplier,true,2026-08-15T13:10:27.340Z
stk_56,J056,Paneer (পনির),Dairy Items,g,400.25,150,40,Egra Supplier,true,2026-08-09T16:10:22.921Z
stk_70,J070,Bisleri Soda,Cold Drinks,pcs,0,10,20,Egra Supplier,false,2026-08-05T15:50:42.580Z
stk_64,J064,Bisleri Water 1L,Cold Drinks,pcs,98,35,20,Egra Supplier,true,2026-08-14T17:37:19.792Z
stk_71,J071,Thums Up 500ml,Cold Drinks,pcs,20,10,30,Egra Supplier,false,2026-08-14T17:38:05.327Z
stk_39,J039,Rose Petals,Bhusimal & Spices,g,350,50,0.8,Egra Supplier,true,2026-08-05T17:27:26.062Z
stk_7,J007,Chowmein Noodle (চাউমিন),Bhusimal & Spices,packet,62,20,10.4,Egra Supplier,true,2026-08-15T13:10:37.868Z
stk_14,J014,Chat Masala,Bhusimal & Spices,packet,11,2,40,Egra Supplier,true,2026-08-13T15:43:24.950Z
stk_13,J013,Kasuri Methi,Bhusimal & Spices,pcs,107,5,12.5,Egra Supplier,true,2026-08-15T13:11:12.132Z
stk_72,J072,Thums Up 750ml,Cold Drinks,pcs,0,24,0,Egra Supplier,false,2026-08-04T14:32:01.363Z
stk_87,J087,Pudina Pata (Mint),Fresh Vegetables,kg,0,1,0,Egra Supplier,false,2026-08-04T14:32:01.363Z
stk_89,J089,Rs 10 Rabdi,Ice Cream,pcs,0,20,0,Egra Supplier,false,2026-08-04T14:32:01.363Z
stk_91,J091,Rs 10 Bati,Ice Cream,pcs,0,20,0,Egra Supplier,false,2026-08-04T14:32:01.363Z
stk_92,J092,Rs 20 Bati,Ice Cream,pcs,0,20,0,Egra Supplier,false,2026-08-04T14:32:01.363Z
stk_94,J094,Rs 25 Cone,Ice Cream,pcs,0,20,0,Egra Supplier,false,2026-08-04T14:32:01.363Z
stk_96,J096,Rs 40 Cone,Ice Cream,pcs,0,20,0,Egra Supplier,false,2026-08-04T14:32:01.363Z
stk_97,J097,Rs 50 Cone,Ice Cream,pcs,0,20,0,Egra Supplier,false,2026-08-04T14:32:01.363Z
stk_98,J098,Rs 60 Cone,Ice Cream,pcs,0,15,0,Egra Supplier,false,2026-08-04T14:32:01.363Z
stk_99,J099,Rs 80 Stick,Ice Cream,pcs,0,15,0,Egra Supplier,false,2026-08-04T14:32:01.363Z
stk_100,J100,Rs 100 Cone,Ice Cream,pcs,0,10,0,Egra Supplier,false,2026-08-04T14:32:01.363Z
stk_101,J101,Family Pack Ice Cream,Ice Cream,pcs,0,5,0,Egra Supplier,false,2026-08-04T14:32:01.363Z
stk_102,J102,1L Gallon Vanilla,Ice Cream,pcs,0,5,0,Egra Supplier,false,2026-08-04T14:32:01.363Z
stk_103,J103,1L Gallon Butter Scotch,Ice Cream,pcs,0,5,0,Egra Supplier,false,2026-08-04T14:32:01.363Z
stk_120,J120,Foil Container,Packaging & Carry Bags,pcs,0,100,0,Egra Supplier,false,2026-08-04T14:32:01.363Z
stk_130,J130,Bleaching Powder,Cleaning & Washings,kg,0,5,0,Egra Supplier,false,2026-08-04T14:32:01.363Z
stk_131,J131,Washing Powder,Cleaning & Washings,kg,0,10,0,Egra Supplier,false,2026-08-04T14:32:01.363Z
stk_132,J132,Floor Cleaner Liquid,Cleaning & Washings,L,99,5,0,Egra Supplier,false,2026-08-04T14:36:50.465Z
stk_77,J077,Ginger (আদা),Fresh Vegetables,kg,0,1,160,Egra Supplier,true,2026-08-13T15:52:43.943Z
stk_82,J082,Green Chilli (কাঁচা লঙ্কা),Fresh Vegetables,kg,2.25,1,80,Egra Supplier,true,2026-08-15T16:02:03.920Z
stk_124,J124,Vim Soap / Bar (Bhim Srap),Cleaning & Washings,pcs,9,5,5,Egra Supplier,true,2026-08-15T14:27:01.071Z
stk_110,J110,Chatni Box,Packaging & Carry Bags,packet,8,2,50,Egra Supplier,true,2026-08-15T13:28:48.959Z
stk_73,J073,Sprite 500ml,Cold Drinks,pcs,28,10,30,Egra Supplier,true,2026-08-14T17:38:34.207Z
stk_76,J076,Onion (পেঁয়াজ),Fresh Vegetables,kg,23.7,12,33,Egra Supplier,true,2026-08-15T16:00:59.793Z
stk_84,J084,Cabbage (বাঁধাকপি),Fresh Vegetables,kg,4.58,2,30,Egra Supplier,true,2026-08-14T06:28:20.841Z
stk_104,J104,1000ml Container,Packaging & Carry Bags,pcs,397,100,7.5,Egra Supplier,true,2026-08-15T13:29:21.346Z
stk_116,J116,7x9 SP Pouch,Packaging & Carry Bags,packet,4,1,70,Egra Supplier,true,2026-08-11T14:38:08.672Z
stk_86,J086,Dhania Pata (Coriander),Fresh Vegetables,kg,0.7,1,100,Egra Supplier,true,2026-08-15T16:02:45.744Z
stk_112,J112,13x16 Carry Bag,Packaging & Carry Bags,packet,3,3,55,Egra Supplier,true,2026-08-12T16:05:30.851Z
stk_88,J088,Cucumber (শসা),Fresh Vegetables,kg,2.2,1,40,Egra Supplier,true,2026-08-15T16:03:39.888Z
stk_105,J105,750ml Silver Container,Packaging & Carry Bags,pcs,500,100,3.4,Egra Supplier,false,2026-08-05T15:15:56.169Z
stk_107,J107,500ml Container,Packaging & Carry Bags,pcs,150,100,5,Egra Supplier,false,2026-08-05T15:16:26.785Z
stk_79,J079,Capsicum,Fresh Vegetables,kg,4.3,1,80,Egra Supplier,true,2026-08-15T16:01:18.193Z
stk_106,J106,750ml Container,Packaging & Carry Bags,pcs,449,100,6.5,Egra Supplier,true,2026-08-13T15:50:54.462Z
stk_117,J117,9x12 SP Pouch,Packaging & Carry Bags,packet,2,1,120,Egra Supplier,true,2026-08-09T16:08:22.673Z
stk_114,J114,Rubber Band Big (Gardar),Packaging & Carry Bags,kg,0.25,0.1,400,Egra Supplier,false,2026-08-05T15:19:20.330Z
stk_115,J115,Cling Wrap (Clean Tape),Packaging & Carry Bags,pcs,2,1,450,Egra Supplier,false,2026-08-05T15:19:36.084Z
stk_113,J113,Rubber Band Small (Gardar),Packaging & Carry Bags,kg,0.25,0.1,400,Egra Supplier,false,2026-08-05T15:19:08.535Z
stk_118,J118,6x8 SP Pouch,Packaging & Carry Bags,pcs,2,1,65,Egra Supplier,true,2026-08-11T14:38:23.370Z
stk_80,J080,Carrot,Fresh Vegetables,kg,2.3,1,40,Egra Supplier,true,2026-08-15T16:01:35.505Z
stk_111,J111,16x20 Carry Bag,Packaging & Carry Bags,packet,9,2,85,Egra Supplier,true,2026-08-11T14:38:38.464Z
stk_121,J121,Silver Roll Foil,Packaging & Carry Bags,packet,1,1,380,Egra Supplier,false,2026-08-05T15:20:46.883Z
stk_122,J122,plastic Hand Gloves,Packaging & Carry Bags,packet,2,1,154,Egra Supplier,false,2026-08-05T15:21:28.363Z
stk_119,J119,Plastic Spoon,Packaging & Carry Bags,packet,2,1,130,Egra Supplier,false,2026-08-05T15:47:02.934Z
stk_123,J123,Chef Cap,Packaging & Carry Bags,packet,2,1,80,Egra Supplier,false,2026-08-05T15:21:59.399Z
stk_1785942899649,J135,rabar hand glove,Packaging & Carry Bags,packet,3,1,314,,true,2026-08-05T15:14:59.649Z
stk_75,J075,Potato (আলু),Fresh Vegetables,kg,30.3,8,15,Egra Supplier,true,2026-08-15T15:59:51.657Z
stk_83,J083,Tomato (টমেটো),Fresh Vegetables,kg,2.15,1,40,Egra Supplier,true,2026-08-15T16:02:21.729Z
stk_108,J108,Tissue Paper,Packaging & Carry Bags,packet,17,5,15,Egra Supplier,true,2026-08-12T16:06:25.861Z
stk_125,J125,Vim Liquid Dishwash,Cleaning & Washings,packet,2,1,200,Egra Supplier,false,2026-08-05T16:50:30.433Z
stk_109,J109,Raita Pouch,Packaging & Carry Bags,packet,10,2,27,Egra Supplier,false,2026-08-05T15:46:27.556Z
stk_74,J074,Sprite 1L,Cold Drinks,pcs,0,24,0,Egra Supplier,false,2026-08-14T17:39:08.517Z
stk_78,J078,Garlic (রসুন),Fresh Vegetables,kg,1.3,1,150,Egra Supplier,true,2026-08-13T15:53:01.430Z
stk_126,J126,Surf Excel Detergent,Cleaning & Washings,packet,3,2,80,Egra Supplier,false,2026-08-05T16:42:50.274Z
stk_127,J127,Hand Wash Liquid,Cleaning & Washings,packet,2,1,100,Egra Supplier,false,2026-08-05T16:45:30.748Z
stk_128,J128,Harpic Toilet Cleaner,Cleaning & Washings,packet,1,1,130,Egra Supplier,false,2026-08-05T16:50:13.538Z
stk_1785945290174,J138,CAMPA JEERA,Cold Drinks,pcs,22,5,20,,true,2026-08-07T18:04:24.126Z
stk_129,J129,Phenyl (Finaile),Cleaning & Washings,packet,1,1,90,Egra Supplier,false,2026-08-05T16:49:51.761Z
stk_90,J090,Rs 10 Cone,Ice Cream,pcs,0,20,0,Egra Supplier,false,2026-08-06T17:21:30.634Z
stk_95,J095,Rs 30 Cone,Ice Cream,pcs,0,20,0,Egra Supplier,false,2026-08-06T17:22:33.610Z
stk_93,J093,Rs 20 Stick,Ice Cream,pcs,0,20,0,Egra Supplier,false,2026-08-06T17:36:18.897Z
stk_81,J081,Beans,Fresh Vegetables,kg,1,1,60,Egra Supplier,true,2026-08-11T14:35:16.942Z
stk_85,J085,Lemon (লেবু),Fresh Vegetables,pcs,10,15,2,Egra Supplier,true,2026-08-14T05:51:25.218Z`;

function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Split taking care of simple commas
    const cols = line.split(",");
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] !== undefined ? cols[idx].trim() : "";
    });
    rows.push(obj);
  }
  return rows;
}

async function seed() {
  console.log("Parsing CSV items...");
  const items = parseCSV(stockItemsCSV).map(r => ({
    id: r.id,
    sku: r.sku,
    name: r.name,
    category: r.category,
    unit: r.unit || "pcs",
    qty: parseFloat(r.qty) || 0,
    min_qty: parseFloat(r.min_qty) || 5,
    cost_price: parseFloat(r.cost_price) || 0,
    supplier: r.supplier || "",
    is_available: r.is_available === "true" || r.is_available === true,
    updated_at: r.updated_at || new Date().toISOString()
  }));

  console.log(`Upserting ${items.length} items into database 'stock_items'...`);
  for (let i = 0; i < items.length; i += 50) {
    const chunk = items.slice(i, i + 50);
    const { error } = await client.database.from("stock_items").upsert(chunk);
    if (error) console.error("Error upserting stock_items chunk:", error);
  }

  console.log("Done syncing items into database.");
}

seed().catch(console.error);

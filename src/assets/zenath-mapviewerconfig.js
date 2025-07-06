function Config() {}
var config = new Config();
config.size = 16;
config.step = 256;
config.x = 2039;
config.y = 1766;
config.mode = "3d";
config.showDeedBordersIn3dMode = false;
config.showDeedBordersInFlatMode = true;

function Deed(name, x, y, height, permanent, sx, sy, ex, ey) {
	this.name = name;
	this.x = x;
	this.y = y;
	this.sx = sx;
	this.sy = sy;
	this.ex = ex;
	this.ey = ey;
	this.height = height;
	this.permanent = permanent;
}

function FocusZone(name, x, y, height, type, sx, sy, ex, ey) {
	this.name = name;
	this.x = x;
	this.y = y;
	this.sx = sx;
	this.sy = sy;
	this.ex = ex;
	this.ey = ey;
	this.height = height;
	this.type = type;
}

var deeds = [];
var focusZones = [];
deeds.push(new Deed('Sol', 2039, 1766, 80, true, 2026, 1727, 2077, 1793));
deeds.push(new Deed('Agnafit', 2073, 2336, 79, false, 1946, 2098, 2143, 2496));
deeds.push(new Deed('Terra', 3441, 2827, 33, false, 3436, 2812, 3456, 2840));
deeds.push(new Deed('Friendly Dragon Strait', 484, 1117, 12, false, 470, 1101, 541, 1134));
deeds.push(new Deed('Scions Of The Scythe', 2434, 379, 5, false, 2416, 361, 2444, 387));
deeds.push(new Deed('Killmule Hill', 2032, 1674, 10, false, 2019, 1662, 2047, 1689));
deeds.push(new Deed('Lonely Lighthouse', 417, 3777, 15, false, 412, 3772, 422, 3782));
deeds.push(new Deed('Sandys Farmstead', 3810, 3763, 13, false, 3805, 3758, 3815, 3768));
deeds.push(new Deed('Little Hope Orphanage', 296, 364, 12, false, 288, 356, 304, 372));
deeds.push(new Deed('Hollow Woods', 3366, 1492, 413, false, 3336, 1427, 3376, 1512));
deeds.push(new Deed('Steinnstowe', 1907, 2285, 4, false, 1837, 2267, 1935, 2303));
deeds.push(new Deed('Spidermonkey Vineyard', 2219, 1830, 3, false, 2193, 1820, 2234, 1850));
deeds.push(new Deed('Southern Waystation', 2043, 3762, 62, false, 2028, 3747, 2063, 3792));
deeds.push(new Deed('Mystery Glade', 2348, 414, 42, false, 2330, 407, 2360, 421));
deeds.push(new Deed('Ragnar\'s Testing Site', 1108, 3610, 387, false, 1097, 3590, 1133, 3640));
deeds.push(new Deed('Gull\'s Nest', 2435, 589, 25, false, 2405, 576, 2455, 614));
deeds.push(new Deed('Western Waystation', 282, 1774, 30, false, 253, 1751, 295, 1803));
deeds.push(new Deed('Northern Waystation', 2040, 208, 10, false, 2035, 203, 2045, 213));
deeds.push(new Deed('Lunas', 1498, 3781, 220, false, 1443, 3721, 1583, 3817));
deeds.push(new Deed('Eastern Waystation', 3801, 1876, 145, false, 3796, 1871, 3806, 1881));
deeds.push(new Deed('Here', 2757, 2170, 117, false, 2744, 2165, 2762, 2175));
deeds.push(new Deed('Legio Praetoria', 1804, 1862, 8, false, 1744, 1834, 1844, 1892));
deeds.push(new Deed('TBA', 2883, 3232, 260, false, 2877, 3223, 2888, 3237));
deeds.push(new Deed('Olbia', 1848, 1788, 31, false, 1841, 1771, 1868, 1793));
deeds.push(new Deed('Keep Of The Black Light', 2337, 2479, 20, false, 2331, 2473, 2343, 2485));
deeds.push(new Deed('Eagle\'s Nest', 3237, 3657, 10, false, 3229, 3612, 3251, 3667));
deeds.push(new Deed('Opps I Smurfed It Again', 1982, 1721, 76, false, 1967, 1711, 1993, 1741));
deeds.push(new Deed('Dragon Muir', 3162, 2501, 118, false, 3137, 2476, 3187, 2526));
focusZones.push(new FocusZone('The Coven', 2306, 1284, 2073, 12, 2291, 1269, 2321, 1299));
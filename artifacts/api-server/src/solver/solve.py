#!/usr/bin/env python3
"""P-Median, Transportation LP, and Capacitated P-Median solvers.
Reads JSON from stdin, writes JSON to stdout."""
import sys, json, time, math
from pulp import (LpProblem, LpMinimize, LpVariable, lpSum,
                  LpConstraint, LpConstraintEQ, LpConstraintLE, LpConstraintGE,
                  LpStatus, value, PULP_CBC_CMD)

# ---------------------------------------------------------------------------
# Dataset: Al's Athletics — P-Median (25 warehouses, 200 customers)
# ---------------------------------------------------------------------------
_WH_DATA = json.loads('{"1": {"id": "ALN", "city": "Allentown", "state": "PA", "lat": 40.602812, "lng": -75.470433}, "2": {"id": "ATL", "city": "Atlanta", "state": "GA", "lat": 33.753693, "lng": -84.389544}, "3": {"id": "BAL", "city": "Baltimore", "state": "MD", "lat": 39.294398, "lng": -76.622747}, "4": {"id": "BOS", "city": "Boston", "state": "MA", "lat": 42.36097, "lng": -71.05344}, "5": {"id": "CHI", "city": "Chicago", "state": "IL", "lat": 41.88331, "lng": -87.624713}, "6": {"id": "CIN", "city": "Cincinnati", "state": "OH", "lat": 39.10663, "lng": -84.49974}, "7": {"id": "CMH", "city": "Columbus", "state": "OH", "lat": 39.991395, "lng": -83.001036}, "8": {"id": "DAL", "city": "Dallas", "state": "TX", "lat": 32.787642, "lng": -96.799525}, "9": {"id": "DEN", "city": "Denver", "state": "CO", "lat": 39.75071, "lng": -104.996225}, "10": {"id": "IND", "city": "Indianapolis", "state": "IN", "lat": 39.77422, "lng": -86.109309}, "11": {"id": "JAX", "city": "Jacksonville", "state": "FL", "lat": 30.32769, "lng": -81.64815}, "12": {"id": "KC", "city": "Kansas City", "state": "MO", "lat": 39.103883, "lng": -94.600613}, "13": {"id": "LV", "city": "Las Vegas", "state": "NV", "lat": 36.17269, "lng": -115.121117}, "14": {"id": "LA", "city": "Los Angeles", "state": "CA", "lat": 33.974044, "lng": -118.248849}, "15": {"id": "MEM", "city": "Memphis", "state": "TN", "lat": 35.033731, "lng": -89.934319}, "16": {"id": "MSP", "city": "Minneapolis", "state": "MN", "lat": 44.985775, "lng": -93.270165}, "17": {"id": "NSH", "city": "Nashville", "state": "TN", "lat": 36.164003, "lng": -86.7745}, "18": {"id": "MSY", "city": "New Orleans", "state": "LA", "lat": 29.956664, "lng": -90.077506}, "19": {"id": "PHX", "city": "Phoenix", "state": "AZ", "lat": 33.451015, "lng": -112.068554}, "20": {"id": "PIT", "city": "Pittsburgh", "state": "PA", "lat": 40.474802, "lng": -79.95449}, "21": {"id": "RDU", "city": "Raleigh", "state": "NC", "lat": 35.773856, "lng": -78.634051}, "22": {"id": "RNO", "city": "Reno", "state": "NV", "lat": 39.529657, "lng": -119.813819}, "23": {"id": "STL", "city": "St. Louis", "state": "MO", "lat": 38.633415, "lng": -90.201924}, "24": {"id": "SEA", "city": "Seattle", "state": "WA", "lat": 47.609722, "lng": -122.333056}, "25": {"id": "TPA", "city": "Tampa", "state": "FL", "lat": 27.950575, "lng": -82.457178}, "26": {"id": "STL2", "city": "St. Louis2", "state": "MO", "lat": 38.6, "lng": -90.18}}')
_CU_DATA = json.loads('{"1": {"id": "C1", "city": "Akron", "state": "OH", "lat": 41.08, "lng": -81.52, "demand": 205375}, "2": {"id": "C2", "city": "Albuquerque", "state": "NM", "lat": 35.12, "lng": -106.62, "demand": 535923}, "3": {"id": "C3", "city": "Alexandria", "state": "VA", "lat": 38.82, "lng": -77.09, "demand": 147786}, "4": {"id": "C4", "city": "Amarillo", "state": "TX", "lat": 35.2, "lng": -101.82, "demand": 190449}, "5": {"id": "C5", "city": "Anaheim", "state": "CA", "lat": 33.84, "lng": -117.87, "demand": 342336}, "6": {"id": "C6", "city": "Brownfield", "state": "TX", "lat": 33.18101, "lng": -102.27066, "demand": 283690}, "7": {"id": "C7", "city": "Arlington", "state": "TX", "lat": 32.69, "lng": -97.13, "demand": 385024}, "8": {"id": "C8", "city": "Arlington", "state": "VA", "lat": 38.88, "lng": -77.1, "demand": 214890}, "9": {"id": "C9", "city": "Atlanta", "state": "GA", "lat": 33.76, "lng": -84.42, "demand": 571861}, "10": {"id": "C10", "city": "Augusta-Richmond", "state": "GA", "lat": 33.46, "lng": -81.99, "demand": 199489}, "11": {"id": "C11", "city": "Aurora", "state": "CO", "lat": 39.71, "lng": -104.73, "demand": 334924}, "12": {"id": "C12", "city": "Aurora", "state": "IL", "lat": 41.77, "lng": -88.29, "demand": 176710}, "13": {"id": "C13", "city": "Austin", "state": "TX", "lat": 30.31, "lng": -97.75, "demand": 792778}, "14": {"id": "C14", "city": "Bakersfield", "state": "CA", "lat": 35.36, "lng": -119, "demand": 336429}, "15": {"id": "C15", "city": "Baltimore", "state": "MD", "lat": 39.3, "lng": -76.61, "demand": 632410}, "16": {"id": "C16", "city": "Baton Rouge", "state": "LA", "lat": 30.45, "lng": -91.13, "demand": 221091}, "17": {"id": "C17", "city": "Bellevue", "state": "WA", "lat": 47.6, "lng": -122.16, "demand": 128225}, "18": {"id": "C18", "city": "Birmingham", "state": "AL", "lat": 33.53, "lng": -86.8, "demand": 226152}, "19": {"id": "C19", "city": "Boise City", "state": "ID", "lat": 43.61, "lng": -116.23, "demand": 210099}, "20": {"id": "C20", "city": "Boston", "state": "MA", "lat": 42.36, "lng": -71.06, "demand": 617594}, "21": {"id": "C21", "city": "Buffalo", "state": "NY", "lat": 42.89, "lng": -78.87, "demand": 292648}, "22": {"id": "C22", "city": "Chandler", "state": "AZ", "lat": 33.3, "lng": -111.84, "demand": 236123}, "23": {"id": "C23", "city": "Charlotte", "state": "NC", "lat": 35.23, "lng": -80.84, "demand": 731424}, "24": {"id": "C24", "city": "Chesapeake", "state": "VA", "lat": 36.82, "lng": -76.28, "demand": 222209}, "25": {"id": "C25", "city": "Chicago", "state": "IL", "lat": 41.85, "lng": -87.65, "demand": 2695598}, "26": {"id": "C26", "city": "Chula Vista", "state": "CA", "lat": 32.64, "lng": -117.08, "demand": 243916}, "27": {"id": "C27", "city": "Cincinnati", "state": "OH", "lat": 39.1, "lng": -84.51, "demand": 296943}, "28": {"id": "C28", "city": "Cleveland", "state": "OH", "lat": 41.48, "lng": -81.68, "demand": 396815}, "29": {"id": "C29", "city": "Colorado Springs", "state": "CO", "lat": 38.86, "lng": -104.76, "demand": 416427}, "30": {"id": "C30", "city": "Columbus", "state": "OH", "lat": 39.96, "lng": -82.99, "demand": 787033}, "31": {"id": "C31", "city": "Corpus Christi", "state": "TX", "lat": 27.8, "lng": -97.4, "demand": 305215}, "32": {"id": "C32", "city": "Dallas", "state": "TX", "lat": 32.79, "lng": -96.77, "demand": 1197816}, "33": {"id": "C33", "city": "Denver", "state": "CO", "lat": 39.74, "lng": -104.98, "demand": 600158}, "34": {"id": "C34", "city": "Detroit", "state": "MI", "lat": 42.33, "lng": -83.05, "demand": 713777}, "35": {"id": "C35", "city": "Durham", "state": "NC", "lat": 35.99, "lng": -78.9, "demand": 228330}, "36": {"id": "C36", "city": "El Paso", "state": "TX", "lat": 31.76, "lng": -106.49, "demand": 649121}, "37": {"id": "C37", "city": "Fort Wayne", "state": "IN", "lat": 41.08, "lng": -85.14, "demand": 253691}, "38": {"id": "C38", "city": "Fort Worth", "state": "TX", "lat": 32.75, "lng": -97.33, "demand": 741206}, "39": {"id": "C39", "city": "Fremont", "state": "CA", "lat": 37.55, "lng": -121.98, "demand": 214089}, "40": {"id": "C40", "city": "Fresno", "state": "CA", "lat": 36.75, "lng": -119.77, "demand": 494665}, "41": {"id": "C41", "city": "Garland", "state": "TX", "lat": 32.91, "lng": -96.64, "demand": 226876}, "42": {"id": "C42", "city": "Gilbert", "state": "AZ", "lat": 33.35, "lng": -111.79, "demand": 208453}, "43": {"id": "C43", "city": "Glendale", "state": "AZ", "lat": 33.53, "lng": -112.19, "demand": 226721}, "44": {"id": "C44", "city": "Glendale", "state": "CA", "lat": 34.14, "lng": -118.26, "demand": 191719}, "45": {"id": "C45", "city": "Greensboro", "state": "NC", "lat": 36.07, "lng": -79.79, "demand": 269666}, "46": {"id": "C46", "city": "Henderson", "state": "NV", "lat": 36.04, "lng": -114.98, "demand": 257729}, "47": {"id": "C47", "city": "Hialeah", "state": "FL", "lat": 25.86, "lng": -80.28, "demand": 224669}, "48": {"id": "C48", "city": "Honolulu", "state": "HI", "lat": 21.31, "lng": -157.86, "demand": 337256}, "49": {"id": "C49", "city": "Houston", "state": "TX", "lat": 29.76, "lng": -95.37, "demand": 2099451}, "50": {"id": "C50", "city": "Indianapolis", "state": "IN", "lat": 39.77, "lng": -86.15, "demand": 820445}, "51": {"id": "C51", "city": "Irvine", "state": "CA", "lat": 33.68, "lng": -117.77, "demand": 212375}, "52": {"id": "C52", "city": "Jacksonville", "state": "FL", "lat": 30.33, "lng": -81.66, "demand": 821784}, "53": {"id": "C53", "city": "Jersey City", "state": "NJ", "lat": 40.71, "lng": -74.06, "demand": 247597}, "54": {"id": "C54", "city": "Kansas City", "state": "MO", "lat": 39.1, "lng": -94.58, "demand": 459787}, "55": {"id": "C55", "city": "Las Vegas", "state": "NV", "lat": 36.18, "lng": -115.14, "demand": 583756}, "56": {"id": "C56", "city": "Laredo", "state": "TX", "lat": 27.52, "lng": -99.49, "demand": 236091}, "57": {"id": "C57", "city": "Lexington-Fayette", "state": "KY", "lat": 38.05, "lng": -84.46, "demand": 295803}, "58": {"id": "C58", "city": "Lincoln", "state": "NE", "lat": 40.81, "lng": -96.68, "demand": 258379}, "59": {"id": "C59", "city": "Long Beach", "state": "CA", "lat": 33.79, "lng": -118.18, "demand": 462257}, "60": {"id": "C60", "city": "Los Angeles", "state": "CA", "lat": 34.05, "lng": -118.24, "demand": 3792621}, "61": {"id": "C61", "city": "Louisville", "state": "KY", "lat": 38.25, "lng": -85.76, "demand": 597337}, "62": {"id": "C62", "city": "Lubbock", "state": "TX", "lat": 33.58, "lng": -101.86, "demand": 229573}, "63": {"id": "C63", "city": "Madison", "state": "WI", "lat": 43.07, "lng": -89.39, "demand": 233209}, "64": {"id": "C64", "city": "Memphis", "state": "TN", "lat": 35.15, "lng": -90.05, "demand": 646889}, "65": {"id": "C65", "city": "Mesa", "state": "AZ", "lat": 33.42, "lng": -111.82, "demand": 439041}, "66": {"id": "C66", "city": "Miami", "state": "FL", "lat": 25.77, "lng": -80.19, "demand": 399457}, "67": {"id": "C67", "city": "Milwaukee", "state": "WI", "lat": 43.05, "lng": -87.96, "demand": 594833}, "68": {"id": "C68", "city": "Minneapolis", "state": "MN", "lat": 44.98, "lng": -93.27, "demand": 382578}, "69": {"id": "C69", "city": "Moreno Valley", "state": "CA", "lat": 33.94, "lng": -117.23, "demand": 193365}, "70": {"id": "C70", "city": "Nashville", "state": "TN", "lat": 36.17, "lng": -86.78, "demand": 601222}, "71": {"id": "C71", "city": "New Orleans", "state": "LA", "lat": 29.95, "lng": -90.07, "demand": 343829}, "72": {"id": "C72", "city": "New York City", "state": "NY", "lat": 40.71, "lng": -74.01, "demand": 8175133}, "73": {"id": "C73", "city": "Norfolk", "state": "VA", "lat": 36.85, "lng": -76.29, "demand": 245782}, "74": {"id": "C74", "city": "North Las Vegas", "state": "NV", "lat": 36.2, "lng": -115.12, "demand": 216961}, "75": {"id": "C75", "city": "Oakland", "state": "CA", "lat": 37.8, "lng": -122.27, "demand": 390724}, "76": {"id": "C76", "city": "Oklahoma City", "state": "OK", "lat": 35.47, "lng": -97.52, "demand": 579999}, "77": {"id": "C77", "city": "Omaha", "state": "NE", "lat": 41.26, "lng": -95.94, "demand": 408958}, "78": {"id": "C78", "city": "Orlando", "state": "FL", "lat": 28.54, "lng": -81.38, "demand": 238300}, "79": {"id": "C79", "city": "Philadelphia", "state": "PA", "lat": 39.95, "lng": -75.17, "demand": 1526006}, "80": {"id": "C80", "city": "Phoenix", "state": "AZ", "lat": 33.45, "lng": -112.07, "demand": 1445632}, "81": {"id": "C81", "city": "Pittsburgh", "state": "PA", "lat": 40.44, "lng": -79.99, "demand": 305704}, "82": {"id": "C82", "city": "Plano", "state": "TX", "lat": 33.02, "lng": -96.7, "demand": 259841}, "83": {"id": "C83", "city": "Portland", "state": "OR", "lat": 45.52, "lng": -122.68, "demand": 583776}, "84": {"id": "C84", "city": "Raleigh", "state": "NC", "lat": 35.77, "lng": -78.64, "demand": 403892}, "85": {"id": "C85", "city": "Reno", "state": "NV", "lat": 39.53, "lng": -119.81, "demand": 225221}, "86": {"id": "C86", "city": "Richmond", "state": "VA", "lat": 37.54, "lng": -77.43, "demand": 204214}, "87": {"id": "C87", "city": "Riverside", "state": "CA", "lat": 33.98, "lng": -117.37, "demand": 303871}, "88": {"id": "C88", "city": "Rochester", "state": "NY", "lat": 43.16, "lng": -77.61, "demand": 210565}, "89": {"id": "C89", "city": "Sacramento", "state": "CA", "lat": 38.58, "lng": -121.49, "demand": 466488}, "90": {"id": "C90", "city": "San Antonio", "state": "TX", "lat": 29.43, "lng": -98.5, "demand": 1327407}, "91": {"id": "C91", "city": "San Diego", "state": "CA", "lat": 32.72, "lng": -117.16, "demand": 1307402}, "92": {"id": "C92", "city": "San Francisco", "state": "CA", "lat": 37.77, "lng": -122.42, "demand": 805235}, "93": {"id": "C93", "city": "San Jose", "state": "CA", "lat": 37.34, "lng": -121.89, "demand": 945942}, "94": {"id": "C94", "city": "Santa Ana", "state": "CA", "lat": 33.75, "lng": -117.87, "demand": 324528}, "95": {"id": "C95", "city": "Scottsdale", "state": "AZ", "lat": 33.49, "lng": -111.92, "demand": 217385}, "96": {"id": "C96", "city": "Seattle", "state": "WA", "lat": 47.6, "lng": -122.33, "demand": 608660}, "97": {"id": "C97", "city": "Shreveport", "state": "LA", "lat": 32.51, "lng": -93.75, "demand": 199311}, "98": {"id": "C98", "city": "Spokane", "state": "WA", "lat": 47.66, "lng": -117.43, "demand": 208916}, "99": {"id": "C99", "city": "St. Louis", "state": "MO", "lat": 38.63, "lng": -90.2, "demand": 319294}, "100": {"id": "C100", "city": "St. Paul", "state": "MN", "lat": 44.94, "lng": -93.09, "demand": 285068}, "101": {"id": "C101", "city": "St. Petersburg", "state": "FL", "lat": 27.77, "lng": -82.68, "demand": 244769}, "102": {"id": "C102", "city": "Stockton", "state": "CA", "lat": 37.98, "lng": -121.31, "demand": 291707}, "103": {"id": "C103", "city": "Tampa", "state": "FL", "lat": 27.95, "lng": -82.46, "demand": 335709}, "104": {"id": "C104", "city": "Toledo", "state": "OH", "lat": 41.66, "lng": -83.56, "demand": 287208}, "105": {"id": "C105", "city": "Tucson", "state": "AZ", "lat": 32.22, "lng": -110.93, "demand": 520116}, "106": {"id": "C106", "city": "Tulsa", "state": "OK", "lat": 36.15, "lng": -95.99, "demand": 391906}, "107": {"id": "C107", "city": "Virginia Beach", "state": "VA", "lat": 36.78, "lng": -76.03, "demand": 437994}, "108": {"id": "C108", "city": "Washington", "state": "DC", "lat": 38.89, "lng": -77.03, "demand": 601723}, "109": {"id": "C109", "city": "Wichita", "state": "KS", "lat": 37.69, "lng": -97.34, "demand": 382368}, "110": {"id": "C110", "city": "Winston-Salem", "state": "NC", "lat": 36.1, "lng": -80.24, "demand": 229617}, "111": {"id": "C111", "city": "Yonkers", "state": "NY", "lat": 40.93, "lng": -73.9, "demand": 195976}, "112": {"id": "C112", "city": "Allentown", "state": "PA", "lat": 40.6, "lng": -75.47, "demand": 118032}, "113": {"id": "C113", "city": "Anchorage", "state": "AK", "lat": 61.22, "lng": -149.9, "demand": 291826}, "114": {"id": "C114", "city": "Ann Arbor", "state": "MI", "lat": 42.28, "lng": -83.74, "demand": 113934}, "115": {"id": "C115", "city": "Antioch", "state": "CA", "lat": 38.0, "lng": -121.8, "demand": 102372}, "116": {"id": "C116", "city": "Athens", "state": "GA", "lat": 33.96, "lng": -83.38, "demand": 115452}, "117": {"id": "C117", "city": "Bakersfield", "state": "CA", "lat": 35.37, "lng": -119.02, "demand": 347483}, "118": {"id": "C118", "city": "Baltimore", "state": "MD", "lat": 39.29, "lng": -76.62, "demand": 620961}, "119": {"id": "C119", "city": "Baton Rouge", "state": "LA", "lat": 30.44, "lng": -91.13, "demand": 229426}, "120": {"id": "C120", "city": "Beaumont", "state": "TX", "lat": 30.08, "lng": -94.13, "demand": 118296}, "121": {"id": "C121", "city": "Berkeley", "state": "CA", "lat": 37.87, "lng": -122.27, "demand": 112580}, "122": {"id": "C122", "city": "Birmingham", "state": "AL", "lat": 33.52, "lng": -86.8, "demand": 212237}, "123": {"id": "C123", "city": "Boise", "state": "ID", "lat": 43.61, "lng": -116.2, "demand": 205671}, "124": {"id": "C124", "city": "Boulder", "state": "CO", "lat": 40.01, "lng": -105.27, "demand": 97385}, "125": {"id": "C125", "city": "Bridgeport", "state": "CT", "lat": 41.17, "lng": -73.2, "demand": 144229}, "126": {"id": "C126", "city": "Buffalo", "state": "NY", "lat": 42.89, "lng": -78.88, "demand": 261310}, "127": {"id": "C127", "city": "Cape Coral", "state": "FL", "lat": 26.56, "lng": -81.95, "demand": 154305}, "128": {"id": "C128", "city": "Carrollton", "state": "TX", "lat": 32.95, "lng": -96.89, "demand": 119087}, "129": {"id": "C129", "city": "Cary", "state": "NC", "lat": 35.79, "lng": -78.78, "demand": 135234}, "130": {"id": "C130", "city": "Cedar Rapids", "state": "IA", "lat": 41.98, "lng": -91.66, "demand": 126396}, "131": {"id": "C131", "city": "Chattanooga", "state": "TN", "lat": 35.05, "lng": -85.31, "demand": 167674}, "132": {"id": "C132", "city": "Clarksville", "state": "TN", "lat": 36.53, "lng": -87.36, "demand": 132957}, "133": {"id": "C133", "city": "Clearwater", "state": "FL", "lat": 27.96, "lng": -82.8, "demand": 107685}, "134": {"id": "C134", "city": "Cleveland", "state": "OH", "lat": 41.5, "lng": -81.7, "demand": 396815}, "135": {"id": "C135", "city": "Columbia", "state": "SC", "lat": 33.99, "lng": -81.04, "demand": 129272}, "136": {"id": "C136", "city": "Corona", "state": "CA", "lat": 33.87, "lng": -117.57, "demand": 152374}, "137": {"id": "C137", "city": "Denton", "state": "TX", "lat": 33.21, "lng": -97.13, "demand": 113383}, "138": {"id": "C138", "city": "Des Moines", "state": "IA", "lat": 41.6, "lng": -93.61, "demand": 203433}, "139": {"id": "C139", "city": "Detroit", "state": "MI", "lat": 42.33, "lng": -83.05, "demand": 688701}, "140": {"id": "C140", "city": "Elk Grove", "state": "CA", "lat": 38.41, "lng": -121.37, "demand": 153015}, "141": {"id": "C141", "city": "Escondido", "state": "CA", "lat": 33.12, "lng": -117.09, "demand": 143911}, "142": {"id": "C142", "city": "Eugene", "state": "OR", "lat": 44.05, "lng": -123.09, "demand": 156185}, "143": {"id": "C143", "city": "Evansville", "state": "IN", "lat": 37.97, "lng": -87.57, "demand": 117429}, "144": {"id": "C144", "city": "Fayetteville", "state": "NC", "lat": 35.05, "lng": -78.88, "demand": 200564}, "145": {"id": "C145", "city": "Fontana", "state": "CA", "lat": 34.09, "lng": -117.43, "demand": 196069}, "146": {"id": "C146", "city": "Fort Collins", "state": "CO", "lat": 40.59, "lng": -105.08, "demand": 143986}, "147": {"id": "C147", "city": "Fort Lauderdale", "state": "FL", "lat": 26.14, "lng": -80.13, "demand": 165521}, "148": {"id": "C148", "city": "Frisco", "state": "TX", "lat": 33.15, "lng": -96.82, "demand": 116989}, "149": {"id": "C149", "city": "Fullerton", "state": "CA", "lat": 33.87, "lng": -117.93, "demand": 135161}, "150": {"id": "C150", "city": "Garden Grove", "state": "CA", "lat": 33.77, "lng": -117.94, "demand": 170883}, "151": {"id": "C151", "city": "Grand Prairie", "state": "TX", "lat": 32.75, "lng": -97.0, "demand": 175396}, "152": {"id": "C152", "city": "Grand Rapids", "state": "MI", "lat": 42.96, "lng": -85.67, "demand": 188040}, "153": {"id": "C153", "city": "Hampton", "state": "VA", "lat": 37.03, "lng": -76.35, "demand": 137436}, "154": {"id": "C154", "city": "Hayward", "state": "CA", "lat": 37.67, "lng": -122.08, "demand": 144186}, "155": {"id": "C155", "city": "High Point", "state": "NC", "lat": 35.96, "lng": -79.99, "demand": 104371}, "156": {"id": "C156", "city": "Hollywood", "state": "FL", "lat": 26.01, "lng": -80.15, "demand": 140768}, "157": {"id": "C157", "city": "Huntington Beach", "state": "CA", "lat": 33.69, "lng": -117.99, "demand": 189992}, "158": {"id": "C158", "city": "Huntsville", "state": "AL", "lat": 34.7, "lng": -86.58, "demand": 180105}, "159": {"id": "C159", "city": "Independence", "state": "MO", "lat": 39.09, "lng": -94.41, "demand": 116830}, "160": {"id": "C160", "city": "Irving", "state": "TX", "lat": 32.81, "lng": -96.95, "demand": 216290}, "161": {"id": "C161", "city": "Jackson", "state": "MS", "lat": 32.3, "lng": -90.18, "demand": 173514}, "162": {"id": "C162", "city": "Joliet", "state": "IL", "lat": 41.53, "lng": -88.08, "demand": 147433}, "163": {"id": "C163", "city": "Kansas City", "state": "KS", "lat": 39.12, "lng": -94.63, "demand": 145786}, "164": {"id": "C164", "city": "Knoxville", "state": "TN", "lat": 35.97, "lng": -83.94, "demand": 178874}, "165": {"id": "C165", "city": "Lakewood", "state": "CO", "lat": 39.7, "lng": -105.09, "demand": 147214}, "166": {"id": "C166", "city": "Lancaster", "state": "CA", "lat": 34.7, "lng": -118.14, "demand": 156633}, "167": {"id": "C167", "city": "Lansing", "state": "MI", "lat": 42.73, "lng": -84.56, "demand": 114297}, "168": {"id": "C168", "city": "Las Vegas", "state": "NV", "lat": 36.17, "lng": -115.14, "demand": 583756}, "169": {"id": "C169", "city": "Laredo", "state": "TX", "lat": 27.52, "lng": -99.49, "demand": 236091}, "170": {"id": "C170", "city": "Lewisville", "state": "TX", "lat": 33.05, "lng": -96.99, "demand": 95290}, "171": {"id": "C171", "city": "Lexington", "state": "KY", "lat": 38.04, "lng": -84.46, "demand": 295803}, "172": {"id": "C172", "city": "Little Rock", "state": "AR", "lat": 34.75, "lng": -92.29, "demand": 193524}, "173": {"id": "C173", "city": "Long Beach", "state": "CA", "lat": 33.77, "lng": -118.19, "demand": 462257}, "174": {"id": "C174", "city": "Louisville", "state": "KY", "lat": 38.25, "lng": -85.76, "demand": 597337}, "175": {"id": "C175", "city": "Lubbock", "state": "TX", "lat": 33.58, "lng": -101.87, "demand": 229573}, "176": {"id": "C176", "city": "Madison", "state": "WI", "lat": 43.07, "lng": -89.39, "demand": 233209}, "177": {"id": "C177", "city": "McAllen", "state": "TX", "lat": 26.2, "lng": -98.23, "demand": 129877}, "178": {"id": "C178", "city": "Memphis", "state": "TN", "lat": 35.15, "lng": -90.05, "demand": 646889}, "179": {"id": "C179", "city": "Mesa", "state": "AZ", "lat": 33.42, "lng": -111.83, "demand": 439041}, "180": {"id": "C180", "city": "Mesquite", "state": "TX", "lat": 32.77, "lng": -96.6, "demand": 139824}, "181": {"id": "C181", "city": "Miami Gardens", "state": "FL", "lat": 25.94, "lng": -80.24, "demand": 107167}, "182": {"id": "C182", "city": "Midland", "state": "TX", "lat": 31.99, "lng": -102.08, "demand": 111147}, "183": {"id": "C183", "city": "Minneapolis", "state": "MN", "lat": 44.98, "lng": -93.27, "demand": 382578}, "184": {"id": "C184", "city": "Miramar", "state": "FL", "lat": 25.99, "lng": -80.33, "demand": 122041}, "185": {"id": "C185", "city": "Mobile", "state": "AL", "lat": 30.68, "lng": -88.04, "demand": 195111}, "186": {"id": "C186", "city": "Montgomery", "state": "AL", "lat": 32.37, "lng": -86.3, "demand": 205764}, "187": {"id": "C187", "city": "Murfreesboro", "state": "TN", "lat": 35.85, "lng": -86.39, "demand": 108755}, "188": {"id": "C188", "city": "Naperville", "state": "IL", "lat": 41.75, "lng": -88.16, "demand": 141853}, "189": {"id": "C189", "city": "New Haven", "state": "CT", "lat": 41.31, "lng": -72.92, "demand": 129779}, "190": {"id": "C190", "city": "New Orleans", "state": "LA", "lat": 29.95, "lng": -90.07, "demand": 343829}, "191": {"id": "C191", "city": "Newport News", "state": "VA", "lat": 36.98, "lng": -76.43, "demand": 180719}, "192": {"id": "C192", "city": "North Las Vegas", "state": "NV", "lat": 36.2, "lng": -115.12, "demand": 216961}, "193": {"id": "C193", "city": "Oceanside", "state": "CA", "lat": 33.2, "lng": -117.38, "demand": 167086}, "194": {"id": "C194", "city": "Ontario", "state": "CA", "lat": 34.06, "lng": -117.65, "demand": 163924}, "195": {"id": "C195", "city": "Orange", "state": "CA", "lat": 33.79, "lng": -117.85, "demand": 136416}, "196": {"id": "C196", "city": "Overland Park", "state": "KS", "lat": 38.89, "lng": -94.69, "demand": 173372}, "197": {"id": "C197", "city": "Oxnard", "state": "CA", "lat": 34.2, "lng": -119.18, "demand": 197899}, "198": {"id": "C198", "city": "Palmdale", "state": "CA", "lat": 34.58, "lng": -118.12, "demand": 152750}, "199": {"id": "C199", "city": "Pasadena", "state": "CA", "lat": 34.15, "lng": -118.14, "demand": 137122}, "200": {"id": "C200", "city": "Pasadena", "state": "TX", "lat": 29.69, "lng": -95.21, "demand": 149043}}')
_DIST_RAW = json.loads('{"1,1": 374, "1,2": 2041, "1,3": 177, "1,4": 1742, "1,5": 2777, "1,7": 1550, "1,8": 173, "1,9": 804, "1,10": 719, "1,11": 1815, "1,12": 791, "1,13": 1692, "1,14": 2799, "1,15": 127, "1,16": 1323, "1,17": 2747, "1,18": 933, "1,19": 2451, "1,20": 306, "1,21": 147, "1,6": 1839, "1,22": 1907, "1,23": 277, "1,24": 1219, "1,25": 1524, "1,26": 446, "1,27": 996, "1,28": 2424, "1,29": 558, "1,30": 773, "1,31": 324, "1,32": 754, "1,33": 2767, "1,34": 577, "1,35": 388, "1,36": 1832, "1,37": 639, "1,38": 469, "1,39": 900, "1,77": 320, "1,40": 2758, "1,41": 1799, "1,42": 1524, "1,43": 547, "1,149": 1918, "1,44": 1528, "1,45": 1822, "1,46": 1115, "1,47": 487, "1,48": 436, "1,49": 2790, "1,51": 2143, "1,50": 2858, "1,52": 2752, "1,53": 2843, "1,54": 501, "1,55": 2743, "1,56": 1822, "1,57": 1219, "1,58": 596, "1,59": 1560, "1,60": 2919, "1,61": 2805, "1,62": 2780, "1,63": 2785, "1,64": 1511, "1,65": 2417, "1,66": 2435, "1,67": 2790, "1,68": 1543, "1,69": 647, "1,70": 461, "1,71": 294, "1,72": 2923, "1,73": 2532, "1,74": 1244, "1,75": 1832, "1,76": 1228, "1,78": 1587, "1,79": 2791, "1,80": 864, "1,81": 667, "1,82": 2779, "1,83": 1533, "1,84": 1175, "1,85": 931, "1,86": 87, "1,87": 779, "1,88": 1196, "1,89": 1208, "1,90": 660, "1,91": 1838, "1,92": 2769, "1,93": 1929, "1,94": 2541, "1,95": 603, "1,96": 1307, "1,97": 1186, "1,98": 2797, "1,99": 2802, "1,100": 674, "1,101": 1801, "1,102": 1931, "1,103": 1500, "1,104": 867, "1,105": 1035, "1,106": 2412, "1,107": 1515, "1,108": 1301, "1,109": 1249, "1,110": 783, "1,111": 1119, "1,112": 1160, "1,113": 2854, "1,114": 975, "1,115": 2734, "1,116": 782, "1,117": 806, "1,119": 1285, "1,121": 94, "1,118": 80, "1,120": 294, "1,122": 304, "1,123": 2534, "1,124": 2926, "1,125": 2763, "1,126": 1470, "1,127": 1262, "1,128": 2754, "1,129": 2775, "1,130": 1061, "1,131": 1208, "1,132": 2848, "1,133": 2766, "1,134": 2539, "1,135": 1579, "1,136": 2783, "1,137": 84, "1,138": 1233, "1,140": 52, "1,141": 2429, "1,142": 279, "1,143": 1587, "1,144": 1832, "1,145": 2785, "1,146": 1587, "1,147": 1819, "1,148": 2777, "1,150": 2781, "1,151": 2775, "1,152": 1047, "1,153": 1826, "1,154": 1807, "1,155": 1296, "1,156": 1827, "1,157": 2781, "1,158": 933, "1,159": 1087, "1,160": 2773, "1,161": 1381, "1,162": 1103, "1,163": 1098, "1,164": 768, "1,165": 2767, "1,166": 2771, "1,167": 1047, "1,168": 2743, "1,169": 2820, "1,170": 2773, "1,171": 1219, "1,172": 1308, "1,173": 2795, "1,174": 773, "1,175": 2780, "1,176": 1533, "1,177": 2820, "1,178": 1511, "1,179": 2417, "1,180": 2779, "1,181": 2435, "1,182": 2780, "1,183": 1543, "1,184": 2435, "1,185": 1280, "1,186": 1141, "1,187": 788, "1,188": 1103, "1,189": 1480, "1,190": 1381, "1,191": 1826, "1,192": 2743, "1,193": 2780, "1,194": 2789, "1,195": 2781, "1,196": 1249, "1,197": 2774, "1,198": 2771, "1,199": 2793, "1,200": 2800, "2,1": 2041, "2,2": 2041, "2,3": 1928, "2,4": 3553, "2,5": 3769, "2,6": 3769, "2,7": 3573, "2,8": 1928, "2,9": 1002, "2,10": 3553, "2,11": 3769, "2,12": 1002, "2,13": 3769, "2,14": 3769, "2,15": 1928, "2,16": 3553, "2,17": 3769, "2,18": 1002, "2,19": 3769, "2,20": 3553, "2,21": 1928, "2,22": 3769, "2,23": 1002, "2,24": 3553, "2,25": 3769, "2,26": 1928, "2,27": 1928, "2,28": 3553, "2,29": 3769, "2,30": 3769, "2,31": 1928, "2,32": 3769, "2,33": 3769, "2,34": 3553, "2,35": 3769, "2,36": 3769, "2,37": 3769, "2,38": 3769, "2,39": 3769, "2,40": 3769, "2,41": 3769, "2,42": 3769, "2,43": 3769, "2,44": 3769, "2,45": 3769, "2,46": 3769, "2,47": 3769, "2,48": 3769, "2,49": 3769, "2,50": 3769, "2,51": 3769, "2,52": 3769, "2,53": 3769, "2,54": 1928, "2,55": 3769, "2,56": 3769, "2,57": 3769, "2,58": 3553, "2,59": 3769, "2,60": 3769, "2,61": 3769, "2,62": 3769, "2,63": 3769, "2,64": 3769, "2,65": 3769, "2,66": 3769, "2,67": 3769, "2,68": 3553, "2,69": 3769, "2,70": 3769, "2,71": 3769, "2,72": 3769, "2,73": 3769, "2,74": 3769, "2,75": 3769, "2,76": 3769, "2,77": 3553, "2,78": 3769, "2,79": 3769, "2,80": 3769, "2,81": 3769, "2,82": 3769, "2,83": 3769, "2,84": 3769, "2,85": 3769, "2,86": 3769, "2,87": 3769, "2,88": 3769, "2,89": 3769, "2,90": 3769, "2,91": 3769, "2,92": 3769, "2,93": 3769, "2,94": 3769, "2,95": 3769, "2,96": 3769, "2,97": 3769, "2,98": 3769, "2,99": 3769, "2,100": 3553, "2,101": 3769, "2,102": 3769, "2,103": 3769, "2,104": 3769, "2,105": 3769, "2,106": 3769, "2,107": 3769, "2,108": 3769, "2,109": 3769, "2,110": 3769, "2,111": 3769, "2,112": 3553, "2,113": 3769, "2,114": 3769, "2,115": 3769, "2,116": 3769, "2,117": 3769, "2,118": 3769, "2,119": 3769, "2,120": 3769, "2,121": 3769, "2,122": 3769, "2,123": 3769, "2,124": 3769, "2,125": 3769, "2,126": 3769, "2,127": 3769, "2,128": 3769, "2,129": 3769, "2,130": 3553, "2,131": 3769, "2,132": 3769, "2,133": 3769, "2,134": 3769, "2,135": 3769, "2,136": 3769, "2,137": 3769, "2,138": 3553, "2,139": 3769, "2,140": 3769, "2,141": 3769, "2,142": 3769, "2,143": 3769, "2,144": 3769, "2,145": 3769, "2,146": 3769, "2,147": 3769, "2,148": 3769, "2,149": 3769, "2,150": 3769, "2,151": 3769, "2,152": 3769, "2,153": 3769, "2,154": 3769, "2,155": 3769, "2,156": 3769, "2,157": 3769, "2,158": 3769, "2,159": 3769, "2,160": 3769, "2,161": 3769, "2,162": 3769, "2,163": 3769, "2,164": 3769, "2,165": 3769, "2,166": 3769, "2,167": 3769, "2,168": 3769, "2,169": 3769, "2,170": 3769, "2,171": 3769, "2,172": 3769, "2,173": 3769, "2,174": 3769, "2,175": 3769, "2,176": 3769, "2,177": 3769, "2,178": 3769, "2,179": 3769, "2,180": 3769, "2,181": 3769, "2,182": 3769, "2,183": 3769, "2,184": 3769, "2,185": 3769, "2,186": 3769, "2,187": 3769, "2,188": 3769, "2,189": 3769, "2,190": 3769, "2,191": 3769, "2,192": 3769, "2,193": 3769, "2,194": 3769, "2,195": 3769, "2,196": 3769, "2,197": 3769, "2,198": 3769, "2,199": 3769, "2,200": 3769}')

WAREHOUSES     = {int(k): v for k, v in _WH_DATA.items()}
CUSTOMERS      = {int(k): v for k, v in _CU_DATA.items()}
DISTANCE       = {(int(k.split(',')[0]), int(k.split(',')[1])): v for k, v in _DIST_RAW.items()}
TOTAL_DEMAND   = sum(c['demand'] for c in CUSTOMERS.values())
WH_STRING_TO_NUM = {v['id']: int(k) for k, v in _WH_DATA.items()}

# ---------------------------------------------------------------------------
# Dataset: Coal Mines → Power Stations (Chapter 5 Transportation LP)
# ---------------------------------------------------------------------------
COAL_MINES = {
    "PRB": {"id": "PRB", "name": "Powder River Basin", "city": "Gillette",  "state": "WY", "lat": 44.291,  "lng": -105.502, "capacity": 30_000_000},
    "APP": {"id": "APP", "name": "Central Appalachian","city": "Logan",     "state": "WV", "lat": 37.848,  "lng":  -81.990, "capacity": 18_000_000},
    "ILB": {"id": "ILB", "name": "Illinois Basin",     "city": "Marion",    "state": "IL", "lat": 37.730,  "lng":  -88.932, "capacity": 14_000_000},
    "UNT": {"id": "UNT", "name": "Uinta Basin",        "city": "Craig",     "state": "CO", "lat": 40.515,  "lng": -107.546, "capacity": 11_000_000},
}

POWER_STATIONS = {
    "CHI": {"id": "CHI", "city": "Chicago",      "state": "IL", "lat": 41.883, "lng": -87.625,  "demand": 7_000_000},
    "DET": {"id": "DET", "city": "Detroit",      "state": "MI", "lat": 42.331, "lng": -83.046,  "demand": 5_500_000},
    "PIT": {"id": "PIT", "city": "Pittsburgh",   "state": "PA", "lat": 40.440, "lng": -79.996,  "demand": 5_000_000},
    "CLE": {"id": "CLE", "city": "Cleveland",    "state": "OH", "lat": 41.500, "lng": -81.695,  "demand": 4_500_000},
    "NYC": {"id": "NYC", "city": "New York",     "state": "NY", "lat": 40.713, "lng": -74.006,  "demand": 8_000_000},
    "ATL": {"id": "ATL", "city": "Atlanta",      "state": "GA", "lat": 33.749, "lng": -84.388,  "demand": 4_000_000},
    "DAL": {"id": "DAL", "city": "Dallas",       "state": "TX", "lat": 32.777, "lng": -96.797,  "demand": 5_000_000},
    "HOU": {"id": "HOU", "city": "Houston",      "state": "TX", "lat": 29.760, "lng": -95.370,  "demand": 6_000_000},
    "PHX": {"id": "PHX", "city": "Phoenix",      "state": "AZ", "lat": 33.448, "lng": -112.074, "demand": 4_000_000},
    "LAX": {"id": "LAX", "city": "Los Angeles",  "state": "CA", "lat": 34.052, "lng": -118.244, "demand": 4_000_000},
    "DEN": {"id": "DEN", "city": "Denver",       "state": "CO", "lat": 39.739, "lng": -104.984, "demand": 3_500_000},
    "MSP": {"id": "MSP", "city": "Minneapolis",  "state": "MN", "lat": 44.978, "lng":  -93.265, "demand": 4_000_000},
    "MCI": {"id": "MCI", "city": "Kansas City",  "state": "MO", "lat": 39.100, "lng":  -94.578, "demand": 3_500_000},
    "CMH": {"id": "CMH", "city": "Columbus",     "state": "OH", "lat": 39.961, "lng":  -82.999, "demand": 4_500_000},
    "IND": {"id": "IND", "city": "Indianapolis", "state": "IN", "lat": 39.768, "lng":  -86.158, "demand": 4_500_000},
}

# ---------------------------------------------------------------------------
# Dataset: Brazil Facility Location (Chapter 5 Capacitated P-Median)
# 26 candidate warehouse cities, 25 demand regions (states)
# ---------------------------------------------------------------------------
BRAZIL_WAREHOUSES = {
    "ANP": {"id": "ANP", "city": "Anápolis",       "state": "GO", "lat": -16.33, "lng": -48.95},
    "BEL": {"id": "BEL", "city": "Belém",           "state": "PA", "lat":  -1.46, "lng": -48.50},
    "BHZ": {"id": "BHZ", "city": "Belo Horizonte",  "state": "MG", "lat": -19.92, "lng": -43.94},
    "BSB": {"id": "BSB", "city": "Brasília",         "state": "DF", "lat": -15.78, "lng": -47.93},
    "CPN": {"id": "CPN", "city": "Campinas",         "state": "SP", "lat": -22.91, "lng": -47.06},
    "CGR": {"id": "CGR", "city": "Campo Grande",    "state": "MS", "lat": -20.46, "lng": -54.62},
    "CGB": {"id": "CGB", "city": "Cuiabá",           "state": "MT", "lat": -15.60, "lng": -56.10},
    "CWB": {"id": "CWB", "city": "Curitiba",         "state": "PR", "lat": -25.43, "lng": -49.27},
    "FOR": {"id": "FOR", "city": "Fortaleza",        "state": "CE", "lat":  -3.72, "lng": -38.54},
    "GYN": {"id": "GYN", "city": "Goiânia",          "state": "GO", "lat": -16.69, "lng": -49.25},
    "JPA": {"id": "JPA", "city": "João Pessoa",      "state": "PB", "lat":  -7.12, "lng": -34.86},
    "LDB": {"id": "LDB", "city": "Londrina",         "state": "PR", "lat": -23.30, "lng": -51.17},
    "MAO": {"id": "MAO", "city": "Manaus",           "state": "AM", "lat":  -3.10, "lng": -60.02},
    "MCZ": {"id": "MCZ", "city": "Maceió",           "state": "AL", "lat":  -9.67, "lng": -35.74},
    "NAT": {"id": "NAT", "city": "Natal",            "state": "RN", "lat":  -5.79, "lng": -35.21},
    "POA": {"id": "POA", "city": "Porto Alegre",     "state": "RS", "lat": -30.03, "lng": -51.23},
    "PVH": {"id": "PVH", "city": "Porto Velho",      "state": "RO", "lat":  -8.76, "lng": -63.90},
    "REC": {"id": "REC", "city": "Recife",           "state": "PE", "lat":  -8.05, "lng": -34.88},
    "RAO": {"id": "RAO", "city": "Ribeirão Preto",   "state": "SP", "lat": -21.18, "lng": -47.81},
    "GIG": {"id": "GIG", "city": "Rio de Janeiro",   "state": "RJ", "lat": -22.91, "lng": -43.17},
    "SSA": {"id": "SSA", "city": "Salvador",         "state": "BA", "lat": -12.97, "lng": -38.50},
    "STS": {"id": "STS", "city": "Santos",           "state": "SP", "lat": -23.96, "lng": -46.33},
    "SLZ": {"id": "SLZ", "city": "São Luís",         "state": "MA", "lat":  -2.53, "lng": -44.30},
    "GRU": {"id": "GRU", "city": "São Paulo",        "state": "SP", "lat": -23.55, "lng": -46.63},
    "THE": {"id": "THE", "city": "Teresina",         "state": "PI", "lat":  -5.09, "lng": -42.80},
    "UDI": {"id": "UDI", "city": "Uberlândia",       "state": "MG", "lat": -18.91, "lng": -48.28},
}

BRAZIL_REGIONS = {
    "AC":  {"id": "AC",  "name": "Acre",                   "lat":  -9.02, "lng": -70.81, "demand":    850_000},
    "AL":  {"id": "AL",  "name": "Alagoas",                 "lat":  -9.67, "lng": -36.50, "demand":  1_100_000},
    "AP":  {"id": "AP",  "name": "Amapá",                   "lat":   1.41, "lng": -51.77, "demand":    650_000},
    "AM":  {"id": "AM",  "name": "Amazonas",                "lat":  -3.47, "lng": -65.10, "demand":  2_200_000},
    "BA":  {"id": "BA",  "name": "Bahia",                   "lat": -12.97, "lng": -41.90, "demand":  5_500_000},
    "CE":  {"id": "CE",  "name": "Ceará",                   "lat":  -5.20, "lng": -39.35, "demand":  3_800_000},
    "ES":  {"id": "ES",  "name": "Espírito Santo",          "lat": -19.19, "lng": -40.34, "demand":  1_800_000},
    "GO":  {"id": "GO",  "name": "Goiás",                   "lat": -15.83, "lng": -49.61, "demand":  2_900_000},
    "MA":  {"id": "MA",  "name": "Maranhão",                "lat":  -5.42, "lng": -45.44, "demand":  2_800_000},
    "MT":  {"id": "MT",  "name": "Mato Grosso",             "lat": -12.64, "lng": -55.42, "demand":  1_650_000},
    "MS":  {"id": "MS",  "name": "Mato Grosso do Sul",      "lat": -20.51, "lng": -54.54, "demand":  1_300_000},
    "MG":  {"id": "MG",  "name": "Minas Gerais",            "lat": -18.51, "lng": -44.55, "demand":  8_500_000},
    "PA":  {"id": "PA",  "name": "Pará",                    "lat":  -3.41, "lng": -52.49, "demand":  3_400_000},
    "PB":  {"id": "PB",  "name": "Paraíba",                 "lat":  -7.12, "lng": -36.72, "demand":  1_600_000},
    "PR":  {"id": "PR",  "name": "Paraná",                  "lat": -24.89, "lng": -51.55, "demand":  5_000_000},
    "PE":  {"id": "PE",  "name": "Pernambuco",              "lat":  -8.38, "lng": -37.86, "demand":  3_900_000},
    "PI":  {"id": "PI",  "name": "Piauí",                   "lat":  -7.72, "lng": -42.73, "demand":  1_400_000},
    "RJ":  {"id": "RJ",  "name": "Rio de Janeiro",          "lat": -22.26, "lng": -42.61, "demand":  7_000_000},
    "RN":  {"id": "RN",  "name": "Rio Grande do Norte",     "lat":  -5.81, "lng": -36.59, "demand":  1_500_000},
    "RS":  {"id": "RS",  "name": "Rio Grande do Sul",       "lat": -30.03, "lng": -53.18, "demand":  4_700_000},
    "RO":  {"id": "RO",  "name": "Rondônia",                "lat": -11.50, "lng": -62.80, "demand":    800_000},
    "RR":  {"id": "RR",  "name": "Roraima",                 "lat":   2.09, "lng": -61.66, "demand":    450_000},
    "SC":  {"id": "SC",  "name": "Santa Catarina",          "lat": -27.45, "lng": -50.95, "demand":  3_000_000},
    "SP":  {"id": "SP",  "name": "São Paulo Region",        "lat": -22.25, "lng": -48.60, "demand": 29_029_226},
    "TO":  {"id": "TO",  "name": "Tocantins",               "lat":  -9.46, "lng": -48.26, "demand":    750_000},
}

BRAZIL_TOTAL_DEMAND = sum(r["demand"] for r in BRAZIL_REGIONS.values())
_CIRCUITY = 1.17  # road distance ≈ straight-line × 1.17

def _haversine_km(lat1, lng1, lat2, lng2):
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return 2 * R * math.asin(math.sqrt(a))

def _haversine_mi(lat1, lng1, lat2, lng2):
    R = 3958.8
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return 2 * R * math.asin(math.sqrt(a))

def _transport_distances():
    return {
        (m, s): round(_haversine_mi(
            COAL_MINES[m]["lat"], COAL_MINES[m]["lng"],
            POWER_STATIONS[s]["lat"], POWER_STATIONS[s]["lng"]
        ) * _CIRCUITY, 1)
        for m in COAL_MINES for s in POWER_STATIONS
    }

def _brazil_distances():
    """Compute warehouse→region distances in km×circuity, returned in miles."""
    dist = {}
    for w, wd in BRAZIL_WAREHOUSES.items():
        for r, rd in BRAZIL_REGIONS.items():
            km = _haversine_km(wd["lat"], wd["lng"], rd["lat"], rd["lng"]) * _CIRCUITY
            dist[(w, r)] = round(km * 0.621371, 1)   # convert to miles
    return dist

# ---------------------------------------------------------------------------
# P-Median solver (Chapter 3)
# ---------------------------------------------------------------------------
def solve_pmedian(inp):
    p = inp['pValue']
    distance_bands = sorted(inp['distanceBands'])
    capacity = inp.get('uniformCapacity')
    gap = inp.get('gap', 0.0)
    time_limit = inp.get('timeLimitSec', 120)
    wh_statuses = {ws['warehouseId']: ws['status'] for ws in inp.get('warehouseStatuses', [])}
    excluded_ids = set(inp.get('excludedCustomerIds', []))

    warehouses = list(WAREHOUSES.keys())
    customers_list = [k for k in CUSTOMERS.keys() if CUSTOMERS[k]['id'] not in excluded_ids]

    def get_bounds(wid):
        sid = WAREHOUSES[wid]['id']
        s = wh_statuses.get(sid, 'potential')
        if s == 'forced_open': return (1, 1)
        if s == 'inactive':    return (0, 0)
        return (0, 1)

    start = time.time()

    prob = LpProblem("PMedian", LpMinimize)

    assign_vars   = LpVariable.dicts("A",    [(w, c) for w in warehouses for c in customers_list], 0, 1, cat='Binary')
    facility_vars = LpVariable.dicts("Open", warehouses, 0, 1, cat='Binary')

    prob += lpSum(CUSTOMERS[c]['demand'] * DISTANCE.get((w, c), 9999) * assign_vars[w, c]
                  for w in warehouses for c in customers_list)

    for c in customers_list:
        prob += LpConstraint(lpSum(assign_vars[w, c] for w in warehouses),
                             LpConstraintEQ, f"served_{c}", 1)

    prob += LpConstraint(lpSum(facility_vars[w] for w in warehouses),
                         LpConstraintEQ, "FacilityCount", p)

    if capacity is not None:
        for w in warehouses:
            prob += LpConstraint(
                lpSum(CUSTOMERS[c]['demand'] * assign_vars[w, c] for c in customers_list) - capacity * facility_vars[w],
                LpConstraintLE, f"cap_{w}", 0)

    for w in warehouses:
        lb, ub = get_bounds(w)
        prob += LpConstraint(facility_vars[w], LpConstraintGE, f"lb_{w}", lb)
        prob += LpConstraint(facility_vars[w], LpConstraintLE, f"ub_{w}", ub)

    for w in warehouses:
        for c in customers_list:
            prob += LpConstraint(assign_vars[w, c] - facility_vars[w],
                                 LpConstraintLE, f"route_{w}_{c}", 0)

    solver = PULP_CBC_CMD(keepFiles=False, gapRel=gap, timeLimit=time_limit, msg=False)
    prob.solve(solver)

    run_time = time.time() - start
    status_str = LpStatus[prob.status]

    if status_str == "Infeasible":
        forced_open = sum(1 for w in warehouses if get_bounds(w) == (1,1))
        reason = "Model is infeasible."
        active_demand_count = sum(CUSTOMERS[c]['demand'] for c in customers_list)
        if forced_open > p:
            reason = f"Forced-open warehouses ({forced_open}) exceed p={p}. Increase P or unforce some warehouses."
        elif capacity is not None:
            reason = (f"Capacity={capacity} is too tight. With p={p} warehouses the total capacity "
                      f"({p * capacity:,}) is less than active demand ({active_demand_count:,}). "
                      "Increase P, raise capacity, or remove the capacity constraint.")
        return {"status": "infeasible", "openWarehouseIds": [], "assignments": [],
                "objective": 0, "weightedAvgDistanceMi": 0, "bandCoverage": [],
                "utilization": [], "runTimeSec": round(run_time, 2),
                "solverUsed": "CBC (PuLP)", "infeasibilityReason": reason}

    open_wh_nums = [w for w in warehouses if (facility_vars[w].varValue or 0) > 0.5]
    open_wh_ids  = [WAREHOUSES[w]['id'] for w in open_wh_nums]

    assignments = []
    wh_demand = {w: 0.0 for w in open_wh_nums}
    band_demand = {b: 0.0 for b in distance_bands}
    total_demand_assigned = 0.0

    for c in customers_list:
        assigned_w = None
        for w in open_wh_nums:
            if (assign_vars[w, c].varValue or 0) > 0.5:
                assigned_w = w
                break
        if assigned_w is None:
            assigned_w = min(open_wh_nums, key=lambda w: DISTANCE.get((w, c), 9999))

        dist   = DISTANCE.get((assigned_w, c), 0)
        demand = CUSTOMERS[c]['demand']
        wh_demand[assigned_w] += demand
        total_demand_assigned += demand
        band_idx = next((i for i, b in enumerate(distance_bands) if dist <= b), len(distance_bands) - 1)
        assignments.append({"customerId": f"C{c}", "warehouseId": WAREHOUSES[assigned_w]['id'],
                             "distanceMi": dist, "band": band_idx})
        for b in distance_bands:
            if dist <= b:
                band_demand[b] += demand

    obj_val   = value(prob.objective) or 0
    active_demand = total_demand_assigned if total_demand_assigned > 0 else 1
    wt_avg    = obj_val / active_demand
    band_coverage = [{"band": b, "percent": round(band_demand[b] * 100 / active_demand)} for b in distance_bands]
    avg_demand_per_wh = active_demand / len(open_wh_nums) if open_wh_nums else 1
    cap_for_util = capacity if (capacity and capacity < active_demand) else avg_demand_per_wh
    utilization = [{"warehouseId": WAREHOUSES[w]['id'], "city": WAREHOUSES[w]['city'],
                    "utilization": min(100, round(wh_demand[w] * 100 / cap_for_util))} for w in open_wh_nums]

    return {"status": "optimal", "openWarehouseIds": open_wh_ids, "assignments": assignments,
            "objective": round(obj_val), "weightedAvgDistanceMi": round(wt_avg, 1),
            "bandCoverage": band_coverage, "utilization": utilization,
            "runTimeSec": round(run_time, 2), "solverUsed": "CBC (PuLP)", "infeasibilityReason": None}

# ---------------------------------------------------------------------------
# Transportation LP solver (Chapter 5)
# ---------------------------------------------------------------------------
def solve_transport(inp):
    capacity_factor   = float(inp.get('capacityFactor', 1.0))
    single_source     = bool(inp.get('singleSource', False))
    capacity_inactive = bool(inp.get('capacityInactive', False))
    distance_bands    = sorted(inp.get('distanceBands', [500, 1000, 1500, 2000]))
    gap               = float(inp.get('gap', 0.0))
    time_limit        = int(inp.get('timeLimitSec', 120))

    mines    = list(COAL_MINES.keys())
    stations = list(POWER_STATIONS.keys())
    dist     = _transport_distances()
    total_demand = sum(s['demand'] for s in POWER_STATIONS.values())

    start = time.time()
    prob  = LpProblem("TransportLP", LpMinimize)

    flow = LpVariable.dicts("Flow", [(m, s) for m in mines for s in stations], lowBound=0)

    if single_source:
        source = LpVariable.dicts("Src", [(m, s) for m in mines for s in stations], 0, 1, cat='Binary')

    prob += lpSum(dist[m, s] * flow[m, s] for m in mines for s in stations)

    for s in stations:
        prob += LpConstraint(
            lpSum(flow[m, s] for m in mines),
            LpConstraintEQ, f"demand_{s}", POWER_STATIONS[s]['demand'])

    if not capacity_inactive:
        for m in mines:
            cap = COAL_MINES[m]['capacity'] * capacity_factor
            prob += LpConstraint(
                lpSum(flow[m, s] for s in stations),
                LpConstraintLE, f"cap_{m}", cap)

    if single_source:
        for s in stations:
            prob += LpConstraint(
                lpSum(source[m, s] for m in mines),
                LpConstraintEQ, f"onesrc_{s}", 1)
            for m in mines:
                prob += LpConstraint(
                    flow[m, s] - POWER_STATIONS[s]['demand'] * source[m, s],
                    LpConstraintLE, f"link_{m}_{s}", 0)

    solver = PULP_CBC_CMD(keepFiles=False, gapRel=gap, timeLimit=time_limit, msg=False)
    prob.solve(solver)

    run_time   = time.time() - start
    status_str = LpStatus[prob.status]

    if status_str == "Infeasible":
        if single_source and not capacity_inactive:
            reason = (
                "Infeasible with single-source + capacity constraints active. "
                f"Each station must be served by exactly one mine, but total mine capacity "
                f"({sum(int(COAL_MINES[m]['capacity']*capacity_factor) for m in mines):,} tons) "
                f"cannot cover all demand ({total_demand:,} tons) under these restrictions. "
                "This is the pedagogical point of exercise part (c). "
                "Fix: (a) disable single-source, (b) increase capacityFactor, or (c) set capacityInactive=true."
            )
        else:
            reason = (
                f"Total mine capacity ({sum(int(COAL_MINES[m]['capacity']*capacity_factor) for m in mines):,} tons) "
                f"is less than total station demand ({total_demand:,} tons). "
                "Increase capacityFactor or set capacityInactive=true."
            )
        return {"status": "infeasible", "openWarehouseIds": list(COAL_MINES.keys()),
                "assignments": [], "objective": 0, "weightedAvgDistanceMi": 0,
                "bandCoverage": [], "utilization": [], "runTimeSec": round(run_time, 2),
                "solverUsed": "CBC (PuLP)", "infeasibilityReason": reason}

    obj_val = value(prob.objective) or 0
    avg_dist = obj_val / total_demand if total_demand > 0 else 0

    assignments = []
    mine_outflow = {m: 0.0 for m in mines}
    band_demand  = {b: 0.0 for b in distance_bands}

    for m in mines:
        for s in stations:
            flow_val = (flow[m, s].varValue or 0)
            if flow_val < 1:
                continue
            d = dist[m, s]
            mine_outflow[m] += flow_val
            band_idx = next((i for i, b in enumerate(distance_bands) if d <= b), len(distance_bands) - 1)
            assignments.append({
                "customerId": s,
                "warehouseId": m,
                "distanceMi": d,
                "band": band_idx,
                "flowTons": round(flow_val),
                "flowFraction": round(flow_val / POWER_STATIONS[s]['demand'], 4)
            })
            for b in distance_bands:
                if d <= b:
                    band_demand[b] += flow_val

    band_coverage = [{"band": b, "percent": round(band_demand[b] * 100 / total_demand)} for b in distance_bands]

    utilization = [{
        "warehouseId": m,
        "city": COAL_MINES[m]['city'],
        "utilization": min(100, round(mine_outflow[m] * 100 / (COAL_MINES[m]['capacity'] * capacity_factor)))
        if not capacity_inactive else round(mine_outflow[m] * 100 / COAL_MINES[m]['capacity'])
    } for m in mines]

    return {
        "status": "optimal",
        "openWarehouseIds": mines,
        "assignments": assignments,
        "objective": round(obj_val),
        "weightedAvgDistanceMi": round(avg_dist, 1),
        "bandCoverage": band_coverage,
        "utilization": utilization,
        "runTimeSec": round(run_time, 2),
        "solverUsed": "CBC (PuLP)",
        "infeasibilityReason": None,
    }

# ---------------------------------------------------------------------------
# Capacitated P-Median solver — Brazil Facility Location (Chapter 5)
# 26 warehouse candidates, 25 demand regions
# singleSource=True  → binary assign (pedagogically infeasible with 20M cap + SP 29M)
# singleSource=False → continuous assign (LP relaxation, always feasible)
# ---------------------------------------------------------------------------
def solve_capacitated_pmedian(inp):
    p               = int(inp.get('pValue', 5))
    wh_cap          = int(inp.get('warehouseCapacity', 20_000_000))
    single_source   = bool(inp.get('singleSource', True))
    gap             = float(inp.get('gap', 0.0))
    time_limit      = int(inp.get('timeLimitSec', 120))
    distance_bands  = sorted(inp.get('distanceBands', [500, 1000, 2000, 4000]))

    warehouses = list(BRAZIL_WAREHOUSES.keys())
    regions    = list(BRAZIL_REGIONS.keys())
    dist       = _brazil_distances()     # in miles

    # Pre-check: if single-source and any region exceeds capacity, report infeasibility
    # immediately without running the solver (faster feedback, clearer message).
    if single_source:
        over_cap = [(rid, BRAZIL_REGIONS[rid]['name'], BRAZIL_REGIONS[rid]['demand'])
                    for rid in regions if BRAZIL_REGIONS[rid]['demand'] > wh_cap]
        if over_cap:
            names = ", ".join(f"{n} ({d/1e6:.0f}M)" for _, n, d in over_cap[:3])
            plural = "regions" if len(over_cap) > 1 else "region"
            return {
                "status": "infeasible",
                "openWarehouseIds": [],
                "assignments": [],
                "objective": 0,
                "weightedAvgDistanceMi": 0,
                "bandCoverage": [],
                "utilization": [],
                "runTimeSec": 0.0,
                "solverUsed": "CBC (PuLP)",
                "infeasibilityReason": (
                    f"Demand {plural} {names} exceed the single-warehouse capacity "
                    f"({wh_cap/1e6:.0f}M). Under single-sourcing each region must be served by "
                    "exactly one warehouse, but no warehouse can absorb this much demand. "
                    "Solution: toggle Single-source OFF to allow demand to split across warehouses."
                ),
            }

    start = time.time()
    prob  = LpProblem("CapPMedian", LpMinimize)

    # assign_vars: binary when single_source, continuous otherwise
    cat = 'Binary' if single_source else 'Continuous'
    assign_vars   = LpVariable.dicts("A",    [(w, r) for w in warehouses for r in regions], 0, 1, cat=cat)
    facility_vars = LpVariable.dicts("Open", warehouses, 0, 1, cat='Binary')

    # Objective: minimise sum of distance * demand * assignment_fraction
    prob += lpSum(dist[w, r] * BRAZIL_REGIONS[r]['demand'] * assign_vars[w, r]
                  for w in warehouses for r in regions)

    # C1: every region fully served (fractions sum to 1)
    for r in regions:
        prob += LpConstraint(
            lpSum(assign_vars[w, r] for w in warehouses),
            LpConstraintEQ, f"served_{r}", 1)

    # C2: open exactly P warehouses
    prob += LpConstraint(
        lpSum(facility_vars[w] for w in warehouses),
        LpConstraintEQ, "FacilityCount", p)

    # C3: capacity per open warehouse
    for w in warehouses:
        prob += LpConstraint(
            lpSum(BRAZIL_REGIONS[r]['demand'] * assign_vars[w, r] for r in regions)
            - wh_cap * facility_vars[w],
            LpConstraintLE, f"cap_{w}", 0)

    # C4: can only assign to an open warehouse
    for w in warehouses:
        for r in regions:
            prob += LpConstraint(
                assign_vars[w, r] - facility_vars[w],
                LpConstraintLE, f"route_{w}_{r}", 0)

    solver = PULP_CBC_CMD(keepFiles=False, gapRel=gap, timeLimit=time_limit, msg=False)
    prob.solve(solver)

    run_time   = time.time() - start
    status_str = LpStatus[prob.status]

    if status_str not in ("Optimal", "Not Solved"):
        # Generic infeasibility fallback
        reason = (
            f"Model is infeasible with P={p}, capacity={wh_cap:,}. "
            f"Total required capacity with P warehouses = {p * wh_cap:,} vs "
            f"total demand = {BRAZIL_TOTAL_DEMAND:,}. "
            "Try increasing P, raising warehouse capacity, or disabling single-sourcing."
        )
        return {
            "status": "infeasible",
            "openWarehouseIds": [],
            "assignments": [],
            "objective": 0,
            "weightedAvgDistanceMi": 0,
            "bandCoverage": [],
            "utilization": [],
            "runTimeSec": round(run_time, 2),
            "solverUsed": "CBC (PuLP)",
            "infeasibilityReason": reason,
        }

    open_wh_ids = [w for w in warehouses if (facility_vars[w].varValue or 0) > 0.5]

    assignments = []
    wh_demand   = {w: 0.0 for w in open_wh_ids}
    band_demand  = {b: 0.0 for b in distance_bands}
    obj_val      = value(prob.objective) or 0

    for r in regions:
        rd = BRAZIL_REGIONS[r]['demand']
        for w in open_wh_ids:
            frac = assign_vars[w, r].varValue or 0
            if frac < 1e-6:
                continue
            d = dist[w, r]
            wh_demand[w] += rd * frac
            band_idx = next((i for i, b in enumerate(distance_bands) if d <= b), len(distance_bands) - 1)
            assignments.append({
                "customerId": r,
                "warehouseId": w,
                "distanceMi": d,
                "band": band_idx,
                "flowFraction": round(frac, 4),
            })
            for b in distance_bands:
                if d <= b:
                    band_demand[b] += rd * frac

    wt_avg = obj_val / BRAZIL_TOTAL_DEMAND if BRAZIL_TOTAL_DEMAND > 0 else 0
    band_coverage = [
        {"band": b, "percent": round(band_demand[b] * 100 / BRAZIL_TOTAL_DEMAND)}
        for b in distance_bands
    ]
    utilization = [
        {
            "warehouseId": w,
            "city": BRAZIL_WAREHOUSES[w]['city'],
            "utilization": min(100, round(wh_demand[w] * 100 / wh_cap)),
        }
        for w in open_wh_ids
    ]

    return {
        "status": "optimal",
        "openWarehouseIds": open_wh_ids,
        "assignments": assignments,
        "objective": round(obj_val),
        "weightedAvgDistanceMi": round(wt_avg, 1),
        "bandCoverage": band_coverage,
        "utilization": utilization,
        "runTimeSec": round(run_time, 2),
        "solverUsed": "CBC (PuLP)",
        "infeasibilityReason": None,
    }

# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------
def solve(inp):
    model_type = inp.get('modelType', 'p_median')
    if model_type == 'transport':
        return solve_transport(inp)
    if model_type == 'capacitated_pmedian':
        return solve_capacitated_pmedian(inp)
    return solve_pmedian(inp)

if __name__ == "__main__":
    inp = json.loads(sys.stdin.read())
    try:
        result = solve(inp)
    except Exception as e:
        result = {"status": "error", "openWarehouseIds": [], "assignments": [],
                  "objective": 0, "weightedAvgDistanceMi": 0, "bandCoverage": [],
                  "utilization": [], "runTimeSec": 0, "solverUsed": "CBC (PuLP)",
                  "infeasibilityReason": str(e)}
    print(json.dumps(result))

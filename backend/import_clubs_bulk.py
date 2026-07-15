"""Import massif de bars et boîtes de nuit sur ~250 villes françaises.

Réutilise le mapping de places_service (_map_place_to_club) et stocke
DÉFINITIVEMENT dans db.places (pas de TTL). Déduplication par place_id.

Usage : python3 import_clubs_bulk.py            # import complet
        python3 import_clubs_bulk.py --city "Le Mans"   # une ville
"""
from __future__ import annotations

import asyncio
import os
import sys
import time

import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from places_service import NEARBY_FIELD_MASK, PLACES_BASE, PLACES_KEY, _map_place_to_club  # noqa: E402

# (nom, lat, lng, grande_ville) — grandes villes = fan-out en grille
CITIES = [
    ("Paris", 48.8566, 2.3522, True), ("Marseille", 43.2965, 5.3698, True),
    ("Lyon", 45.7640, 4.8357, True), ("Toulouse", 43.6047, 1.4442, True),
    ("Nice", 43.7102, 7.2620, True), ("Nantes", 47.2184, -1.5536, True),
    ("Montpellier", 43.6108, 3.8767, True), ("Strasbourg", 48.5734, 7.7521, True),
    ("Bordeaux", 44.8378, -0.5792, True), ("Lille", 50.6292, 3.0573, True),
    ("Rennes", 48.1173, -1.6778, True), ("Reims", 49.2583, 4.0317, False),
    ("Toulon", 43.1242, 5.9280, False), ("Saint-Étienne", 45.4397, 4.3872, False),
    ("Le Havre", 49.4944, 0.1079, False), ("Grenoble", 45.1885, 5.7245, True),
    ("Dijon", 47.3220, 5.0415, False), ("Angers", 47.4784, -0.5632, False),
    ("Nîmes", 43.8367, 4.3601, False), ("Villeurbanne", 45.7719, 4.8902, False),
    ("Clermont-Ferrand", 45.7772, 3.0870, False), ("Le Mans", 48.0061, 0.1996, True),
    ("Aix-en-Provence", 43.5297, 5.4474, False), ("Brest", 48.3904, -4.4861, False),
    ("Tours", 47.3941, 0.6848, False), ("Amiens", 49.8942, 2.2957, False),
    ("Limoges", 45.8336, 1.2611, False), ("Annecy", 45.8992, 6.1294, False),
    ("Perpignan", 42.6887, 2.8948, False), ("Boulogne-Billancourt", 48.8352, 2.2409, False),
    ("Metz", 49.1193, 6.1757, False), ("Besançon", 47.2378, 6.0241, False),
    ("Orléans", 47.9029, 1.9093, False), ("Rouen", 49.4432, 1.0993, False),
    ("Saint-Denis", 48.9362, 2.3574, False), ("Montreuil", 48.8638, 2.4485, False),
    ("Argenteuil", 48.9472, 2.2467, False), ("Mulhouse", 47.7508, 7.3359, False),
    ("Caen", 49.1829, -0.3707, False), ("Nancy", 48.6921, 6.1844, False),
    ("Tourcoing", 50.7239, 3.1612, False), ("Roubaix", 50.6942, 3.1746, False),
    ("Nanterre", 48.8924, 2.2071, False), ("Vitry-sur-Seine", 48.7875, 2.3928, False),
    ("Avignon", 43.9493, 4.8055, False), ("Créteil", 48.7900, 2.4550, False),
    ("Poitiers", 46.5802, 0.3404, False), ("Dunkerque", 51.0343, 2.3768, False),
    ("Versailles", 48.8014, 2.1301, False), ("Aubervilliers", 48.9145, 2.3838, False),
    ("Asnières-sur-Seine", 48.9105, 2.2890, False), ("Colombes", 48.9226, 2.2523, False),
    ("Saint-Pierre", -21.3393, 55.4781, False), ("Aulnay-sous-Bois", 48.9386, 2.4906, False),
    ("Rueil-Malmaison", 48.8770, 2.1808, False), ("Pau", 43.2951, -0.3708, False),
    ("Courbevoie", 48.8977, 2.2566, False), ("La Rochelle", 46.1603, -1.1511, False),
    ("Champigny-sur-Marne", 48.8172, 2.5158, False), ("Antibes", 43.5808, 7.1250, False),
    ("Calais", 50.9513, 1.8587, False), ("Cannes", 43.5528, 7.0174, False),
    ("Béziers", 43.3442, 3.2158, False), ("Colmar", 48.0790, 7.3585, False),
    ("Bourges", 47.0810, 2.3988, False), ("Drancy", 48.9236, 2.4455, False),
    ("Mérignac", 44.8442, -0.6564, False), ("Saint-Nazaire", 47.2735, -2.2137, False),
    ("Valence", 44.9334, 4.8924, False), ("Ajaccio", 41.9192, 8.7386, False),
    ("Issy-les-Moulineaux", 48.8247, 2.2699, False), ("Quimper", 47.9960, -4.1024, False),
    ("Levallois-Perret", 48.8935, 2.2872, False), ("Noisy-le-Grand", 48.8485, 2.5527, False),
    ("Villeneuve-d'Ascq", 50.6231, 3.1348, False), ("Neuilly-sur-Seine", 48.8846, 2.2686, False),
    ("Antony", 48.7537, 2.2976, False), ("Troyes", 48.2973, 4.0744, False),
    ("Clichy", 48.9044, 2.3060, False), ("Montauban", 44.0221, 1.3529, False),
    ("Pantin", 48.8946, 2.4093, False), ("Chambéry", 45.5646, 5.9178, False),
    ("Niort", 46.3239, -0.4646, False), ("Sarcelles", 48.9973, 2.3782, False),
    ("Le Blanc-Mesnil", 48.9385, 2.4627, False), ("Lorient", 47.7482, -3.3702, False),
    ("Beauvais", 49.4295, 2.0807, False), ("Maisons-Alfort", 48.8058, 2.4378, False),
    ("Hyères", 43.1206, 6.1286, False), ("Épinay-sur-Seine", 48.9553, 2.3092, False),
    ("Meaux", 48.9601, 2.8788, False), ("Chelles", 48.8804, 2.5910, False),
    ("Villejuif", 48.7920, 2.3597, False), ("Narbonne", 43.1839, 3.0044, False),
    ("La Seyne-sur-Mer", 43.1005, 5.8783, False), ("Saint-Quentin", 49.8486, 3.2876, False),
    ("Pessac", 44.8067, -0.6311, False), ("Vénissieux", 45.6970, 4.8862, False),
    ("Cergy", 49.0361, 2.0631, False), ("Clamart", 48.8004, 2.2632, False),
    ("Ivry-sur-Seine", 48.8129, 2.3843, False), ("Fontenay-sous-Bois", 48.8517, 2.4772, False),
    ("Bayonne", 43.4933, -1.4748, False), ("Sartrouville", 48.9430, 2.1919, False),
    ("Cholet", 47.0593, -0.8790, False), ("Vannes", 47.6582, -2.7608, False),
    ("Fréjus", 43.4332, 6.7370, False), ("Bondy", 48.9021, 2.4830, False),
    ("Le Cannet", 43.5769, 7.0191, False), ("Arles", 43.6768, 4.6303, False),
    ("Gennevilliers", 48.9333, 2.2979, False), ("Massy", 48.7309, 2.2713, False),
    ("Bourg-en-Bresse", 46.2056, 5.2289, False), ("Corbeil-Essonnes", 48.6139, 2.4820, False),
    ("Saint-André", -20.9633, 55.6503, False), ("Vincennes", 48.8478, 2.4392, False),
    ("Évry-Courcouronnes", 48.6297, 2.4407, False), ("La Roche-sur-Yon", 46.6705, -1.4269, False),
    ("Cachan", 48.7919, 2.3319, False), ("Charleville-Mézières", 49.7625, 4.7262, False),
    ("Angoulême", 45.6484, 0.1562, False), ("Wattrelos", 50.7043, 3.2172, False),
    ("Boulogne-sur-Mer", 50.7264, 1.6147, False), ("Saint-Brieuc", 48.5146, -2.7654, False),
    ("Grasse", 43.6584, 6.9225, False), ("Blois", 47.5861, 1.3359, False),
    ("Châteauroux", 46.8103, 1.6911, False), ("Chalon-sur-Saône", 46.7806, 4.8534, False),
    ("Brive-la-Gaillarde", 45.1585, 1.5333, False), ("Tarbes", 43.2328, 0.0716, False),
    ("Carcassonne", 43.2130, 2.3491, False), ("Albi", 43.9298, 2.1480, False),
    ("Saint-Malo", 48.6493, -2.0257, False), ("Châlons-en-Champagne", 48.9566, 4.3634, False),
    ("Saint-Herblain", 47.2122, -1.6497, False), ("Sète", 43.4029, 3.6966, False),
    ("Bastia", 42.7028, 9.4508, False), ("Istres", 43.5132, 4.9877, False),
    ("Salon-de-Provence", 43.6404, 5.0973, False), ("Le Port", -20.9373, 55.2919, False),
    ("Laval", 48.0785, -0.7660, False), ("Belfort", 47.6380, 6.8629, False),
    ("Évreux", 49.0270, 1.1508, False), ("Vaulx-en-Velin", 45.7768, 4.9186, False),
    ("Meudon", 48.8123, 2.2382, False), ("Alfortville", 48.8050, 2.4239, False),
    ("Saint-Priest", 45.6972, 4.9448, False), ("Sevran", 48.9401, 2.5283, False),
    ("Valenciennes", 50.3570, 3.5233, False), ("Chartres", 48.4439, 1.4893, False),
    ("Bobigny", 48.9066, 2.4394, False), ("Gap", 44.5594, 6.0790, False),
    ("Thionville", 49.3579, 6.1685, False), ("Alès", 44.1253, 4.0812, False),
    ("Saint-Laurent-du-Maroni", 5.4948, -54.0324, False), ("Talence", 44.8043, -0.5907, False),
    ("Saint-Germain-en-Laye", 48.8990, 2.0936, False), ("Rezé", 47.1846, -1.5497, False),
    ("Montrouge", 48.8172, 2.3219, False), ("Marcq-en-Barœul", 50.6711, 3.0972, False),
    ("Cagnes-sur-Mer", 43.6644, 7.1489, False), ("Bron", 45.7394, 4.9130, False),
    ("Anglet", 43.4851, -1.5136, False), ("Melun", 48.5421, 2.6554, False),
    ("Le Perreux-sur-Marne", 48.8420, 2.5033, False), ("Puteaux", 48.8837, 2.2394, False),
    ("Douai", 50.3714, 3.0800, False), ("Compiègne", 49.4179, 2.8261, False),
    ("Agen", 44.2049, 0.6212, False), ("Villepinte", 48.9550, 2.5412, False),
    ("Chatou", 48.8896, 2.1573, False), ("Auxerre", 47.7982, 3.5735, False),
    ("Périgueux", 45.1846, 0.7214, False), ("Nevers", 46.9896, 3.1591, False),
    ("Cambrai", 50.1766, 3.2354, False), ("Villefranche-sur-Saône", 45.9866, 4.7196, False),
    ("Bagneux", 48.7983, 2.3095, False), ("Suresnes", 48.8709, 2.2183, False),
    ("Lens", 50.4292, 2.8326, False), ("Arras", 50.2910, 2.7775, False),
    ("Saint-Chamond", 45.4771, 4.5140, False), ("Montluçon", 46.3403, 2.6033, False),
    ("Vichy", 46.1272, 3.4262, False), ("La Ciotat", 43.1748, 5.6045, False),
    ("Vierzon", 47.2216, 2.0662, False), ("Dieppe", 49.9229, 1.0757, False),
    ("Saumur", 47.2599, -0.0770, False), ("Biarritz", 43.4832, -1.5586, False),
    ("Dax", 43.7102, -1.0536, False), ("Mont-de-Marsan", 43.8903, -0.5006, False),
    ("Rochefort", 45.9421, -0.9588, False), ("Saintes", 45.7454, -0.6337, False),
    ("Royan", 45.6231, -1.0286, False), ("Cognac", 45.6958, -0.3287, False),
    ("Libourne", 44.9153, -0.2432, False), ("Arcachon", 44.6529, -1.1686, False),
    ("Bergerac", 44.8508, 0.4838, False), ("Villeneuve-sur-Lot", 44.4082, 0.7050, False),
    ("Auch", 43.6465, 0.5855, False), ("Castres", 43.6063, 2.2419, False),
    ("Rodez", 44.3506, 2.5750, False), ("Cahors", 44.4491, 1.4365, False),
    ("Millau", 44.0986, 3.0783, False), ("Mende", 44.5176, 3.5010, False),
    ("Le Puy-en-Velay", 45.0433, 3.8853, False), ("Aurillac", 44.9261, 2.4406, False),
    ("Moulins", 46.5661, 3.3336, False), ("Roanne", 46.0341, 4.0687, False),
    ("Annonay", 45.2404, 4.6706, False), ("Montélimar", 44.5581, 4.7508, False),
    ("Romans-sur-Isère", 45.0459, 5.0514, False), ("Vienne", 45.5253, 4.8744, False),
    ("Voiron", 45.3641, 5.5906, False), ("Échirolles", 45.1462, 5.7183, False),
    ("Aix-les-Bains", 45.6887, 5.9151, False), ("Albertville", 45.6754, 6.3925, False),
    ("Thonon-les-Bains", 46.3705, 6.4784, False), ("Annemasse", 46.1934, 6.2342, False),
    ("Cluses", 46.0603, 6.5788, False), ("Chamonix-Mont-Blanc", 45.9237, 6.8694, False),
    ("Oyonnax", 46.2571, 5.6551, False), ("Mâcon", 46.3069, 4.8286, False),
    ("Le Creusot", 46.8035, 4.4161, False), ("Beaune", 47.0261, 4.8399, False),
    ("Sens", 48.1973, 3.2830, False), ("Montbéliard", 47.5104, 6.7989, False),
    ("Dole", 47.0921, 5.4886, False), ("Lons-le-Saunier", 46.6741, 5.5539, False),
    ("Vesoul", 47.6222, 6.1553, False), ("Épinal", 48.1728, 6.4491, False),
    ("Saint-Dié-des-Vosges", 48.2857, 6.9494, False), ("Verdun", 49.1590, 5.3829, False),
    ("Bar-le-Duc", 48.7712, 5.1608, False), ("Sarreguemines", 49.1104, 7.0684, False),
    ("Forbach", 49.1880, 6.9004, False), ("Haguenau", 48.8156, 7.7905, False),
    ("Sélestat", 48.2594, 7.4540, False), ("Saint-Louis", 47.5896, 7.5619, False),
    ("Laon", 49.5641, 3.6199, False), ("Soissons", 49.3817, 3.3235, False),
    ("Creil", 49.2578, 2.4744, False), ("Abbeville", 50.1054, 1.8332, False),
    ("Saint-Omer", 50.7481, 2.2606, False), ("Berck", 50.4074, 1.5936, False),
    ("Maubeuge", 50.2778, 3.9727, False), ("Armentières", 50.6884, 2.8819, False),
    ("Épernay", 49.0403, 3.9596, False), ("Sedan", 49.7018, 4.9403, False),
    ("Cherbourg-en-Cotentin", 49.6337, -1.6222, False), ("Alençon", 48.4329, 0.0916, False),
    ("Lisieux", 49.1466, 0.2300, False), ("Flers", 48.7481, -0.5698, False),
    ("Fécamp", 49.7577, 0.3743, False), ("Elbeuf", 49.2853, 1.0091, False),
    ("Vernon", 49.0930, 1.4849, False), ("Dreux", 48.7372, 1.3664, False),
    ("Fougères", 48.3519, -1.1994, False), ("Vitré", 48.1244, -1.2110, False),
    ("Lannion", 48.7326, -3.4554, False), ("Morlaix", 48.5776, -3.8284, False),
    ("Concarneau", 47.8756, -3.9199, False), ("Pontivy", 48.0687, -2.9626, False),
    ("Redon", 47.6521, -2.0846, False), ("Châteaubriant", 47.7176, -1.3757, False),
    ("Les Sables-d'Olonne", 46.4972, -1.7833, False), ("Challans", 46.8433, -1.8783, False),
    ("Fontenay-le-Comte", 46.4670, -0.8064, False), ("Bressuire", 46.8399, -0.4890, False),
    ("Thouars", 46.9759, -0.2152, False), ("Châtellerault", 46.8178, 0.5461, False),
    ("Guéret", 46.1703, 1.8717, False), ("Tulle", 45.2672, 1.7715, False),
    ("Ussel", 45.5486, 2.3092, False), ("Figeac", 44.6087, 2.0318, False),
    ("Foix", 42.9655, 1.6053, False), ("Pamiers", 43.1163, 1.6110, False),
    ("Saint-Gaudens", 43.1085, 0.7241, False), ("Lourdes", 43.0949, -0.0470, False),
    ("Oloron-Sainte-Marie", 43.1945, -0.6060, False), ("Saint-Jean-de-Luz", 43.3888, -1.6625, False),
    ("Hendaye", 43.3592, -1.7742, False), ("Perros-Guirec", 48.8135, -3.4400, False),
    ("Deauville", 49.3600, 0.0754, False), ("Cabourg", 49.2896, -0.1136, False),
    ("Étretat", 49.7071, 0.2035, False), ("Le Touquet-Paris-Plage", 50.5211, 1.5909, False),
    ("Saint-Tropez", 43.2727, 6.6407, False), ("Sainte-Maxime", 43.3089, 6.6383, False),
    ("Saint-Raphaël", 43.4252, 6.7684, False), ("Juan-les-Pins", 43.5674, 7.1063, False),
    ("Menton", 43.7745, 7.4977, False), ("Monaco", 43.7384, 7.4246, False),
    ("Porto-Vecchio", 41.5912, 9.2795, False), ("Calvi", 42.5679, 8.7575, False),
    ("La Grande-Motte", 43.5606, 4.0864, False), ("Le Cap d'Agde", 43.2790, 3.5122, False),
    ("Palavas-les-Flots", 43.5280, 3.9310, False), ("Gruissan", 43.1075, 3.0863, False),
    ("Argelès-sur-Mer", 42.5461, 3.0225, False), ("Collioure", 42.5252, 3.0836, False),
    ("Font-Romeu", 42.5036, 2.0430, False), ("La Baule-Escoublac", 47.2863, -2.3931, False),
    ("Pornic", 47.1155, -2.1054, False), ("Saint-Gilles-Croix-de-Vie", 46.6969, -1.9451, False),
    ("Val-d'Isère", 45.4481, 6.9800, False), ("Courchevel", 45.4154, 6.6344, False),
    ("Megève", 45.8569, 6.6177, False), ("Les Deux Alpes", 45.0119, 6.1246, False),
    ("Tignes", 45.4685, 6.9061, False), ("Avoriaz", 46.1912, 6.7727, False),
]

TYPE_SETS = [
    ["night_club", "dance_hall"],
    ["bar", "pub"],
    ["karaoke", "wine_bar"],
]


def search_nearby(lat: float, lng: float, radius_km: float, types: list) -> list:
    body = {
        "includedPrimaryTypes": types,
        "maxResultCount": 20,
        "rankPreference": "POPULARITY",
        "locationRestriction": {
            "circle": {"center": {"latitude": lat, "longitude": lng}, "radius": min(radius_km * 1000, 50000)}
        },
    }
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": PLACES_KEY,
        "X-Goog-FieldMask": NEARBY_FIELD_MASK,
    }
    try:
        resp = requests.post(f"{PLACES_BASE}/places:searchNearby", json=body, headers=headers, timeout=15)
        if resp.status_code >= 400:
            print(f"  ! HTTP {resp.status_code}: {resp.text[:120]}")
            return []
        return (resp.json() or {}).get("places", []) or []
    except Exception as exc:  # noqa: BLE001
        print(f"  ! erreur: {exc}")
        return []


async def main():
    if not PLACES_KEY:
        print("GOOGLE_PLACES_API_KEY manquante")
        return
    only_city = None
    if "--city" in sys.argv:
        only_city = sys.argv[sys.argv.index("--city") + 1].lower()

    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "nightfinder")]
    before = await db.places.count_documents({})
    total_new = 0
    calls = 0

    for name, lat, lng, big in CITIES:
        if only_city and only_city not in name.lower():
            continue
        # centres de recherche : centre + satellites pour les grandes villes
        centers = [(lat, lng, 8.0)]
        if big:
            for dlat, dlng in ((0.055, 0), (-0.055, 0), (0, 0.08), (0, -0.08)):
                centers.append((lat + dlat, lng + dlng, 6.0))
        city_new = 0
        for clat, clng, rad in centers:
            for types in TYPE_SETS:
                # petites villes : on saute le 3e set (karaoke/wine_bar)
                if not big and types[0] == "karaoke" and len(centers) == 1 and city_new > 25:
                    continue
                raw = search_nearby(clat, clng, rad, types)
                calls += 1
                for p in raw:
                    club = _map_place_to_club(p)
                    if club.get("lat") is None:
                        continue
                    club.pop("expires_at", None)
                    res = await db.places.update_one(
                        {"club_id": club["club_id"]},
                        {"$setOnInsert": club},
                        upsert=True,
                    )
                    if res.upserted_id is not None:
                        city_new += 1
                time.sleep(0.12)
        total_new += city_new
        print(f"{name}: +{city_new}  (total nouveaux: {total_new}, appels API: {calls})", flush=True)

    after = await db.places.count_documents({})
    print(f"\nTERMINÉ — avant: {before}, après: {after} (+{after - before}), appels API: {calls}")


if __name__ == "__main__":
    asyncio.run(main())

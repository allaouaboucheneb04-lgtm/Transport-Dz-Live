Correction:
- Si Firebase retourne 0 lines ou 0 stops, l’app charge des données locales de secours.
- Carte plein écran affiche lignes + arrêts même si Firestore est vide.
- Badge Mode démo si les données viennent du fallback.
- Cache: ?v=firebase-fallback-1

Important:
- Dès que Firestore contient des vraies collections lines/stops, le fallback ne remplace pas les données.

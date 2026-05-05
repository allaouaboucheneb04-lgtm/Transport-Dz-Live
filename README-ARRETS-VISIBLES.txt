Correction:
- Les arrêts existants Firestore s'affichent même si l'ancien filtre de ligne ne correspond pas.
- Supporte lat/lng et latitude/longitude.
- Affiche le nombre d'arrêts visibles.

Après upload:
ouvre /Transport-Dz-Live/?v=170

Si tu ne les vois toujours pas, vérifie dans Firestore:
collection stops
chaque arrêt doit avoir:
name (string)
lat (number)
lng (number)
lineId (string)

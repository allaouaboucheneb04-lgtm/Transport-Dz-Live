Version ETA bus:
- Ajout champ order pour les arrêts.
- Estimation arrivée du bus à chaque arrêt.
- Affichage côté client: Bus arrive dans X min.
- Utilise uniquement les bus online, visibles, GPS récent et sur leur ligne.
- Vitesse estimée: speedKmh si disponible, sinon 25 km/h.
- Publier firestore.rules inclus si nécessaire.

Après upload:
Ouvre /Transport-Dz-Live/?v=eta-bus-1

Important:
Pour chaque arrêt, ajoute un champ order:
1, 2, 3, 4...

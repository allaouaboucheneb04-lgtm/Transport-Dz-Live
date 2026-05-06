Ajout routes réelles OSRM:
- Les arrêts ne sont plus reliés par ligne droite.
- Chaque ligne est tracée séparément selon son lineId.
- Le tracé suit les rues via OSRM/OpenStreetMap.
- Si OSRM ne répond pas, fallback automatique en ligne droite.
- Quand 'Toutes les lignes' est choisi, chaque ligne reste indépendante.

Après upload:
Ouvre /Transport-Dz-Live/?v=osrm-routes-1

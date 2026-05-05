Correction bouton:
- Suppression du script d'interception qui bugguait.
- Retour à la logique propre dans app.js.
- Les boutons Ajouter ligne/arrêt/véhicule écrivent directement dans Firestore.
- Affiche maintenant l'erreur Firebase exacte si ça bloque.
- Pas de double ajout.

Après upload:
1. Publie firestore.rules
2. Ouvre: /Transport-Dz-Live/?v=button-clean-1
3. Connecte-toi admin
4. Ajoute une ligne
5. Vérifie Firebase > Firestore > Données > lines

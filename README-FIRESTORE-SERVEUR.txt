Correction finale écriture Firebase:
- L'ajout ligne/arrêt/véhicule utilise maintenant l'API serveur Firestore REST.
- Si Firebase accepte, la collection apparaît vraiment dans la console.
- Si Firebase refuse, l'erreur exacte s'affiche (403 rules, auth, etc.).
- Plus de faux affichage local seulement.

Après upload:
1. Publie firestore.rules
2. Ouvre: /Transport-Dz-Live/?v=server-rest-1
3. Connecte-toi admin
4. Ajoute une ligne
5. Vérifie Firestore: collection lines

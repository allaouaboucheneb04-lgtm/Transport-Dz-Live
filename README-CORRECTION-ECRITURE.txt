Correction écriture Firebase directe

J'ai gardé Stablev2 et ajouté firestore-fix.js chargé en dernier.
Il force l'écriture Firestore sur les boutons:
- Enregistrer ligne -> collection lines
- Enregistrer arrêt -> collection stops
- Enregistrer chauffeur -> collection drivers

Un bouton test est ajouté en bas:
"Tester écriture Firestore"
S'il marche, tu verras la collection lines dans Firebase.

Après upload:
1. Publie firestore.rules
2. Ouvre /Transport-Dz-Live/?v=direct-2
3. Connecte-toi admin
4. Clique "Tester écriture Firestore"
5. Vérifie Firestore: collection lines

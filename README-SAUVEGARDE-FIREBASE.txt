CORRECTION SAUVEGARDE FIREBASE

Cette version sauvegarde vraiment dans Firestore:

collections:
- lines
- stops
- vehicles
- drivers
- clients
- users
- admins
- testWrites

Important:
1. Mets firestore.rules dans Firebase > Firestore > Sécurité > Publier
2. Upload tous les fichiers dans GitHub
3. Ouvre:
   /Transport-Dz-Live/?v=3000
4. Connecte-toi comme admin
5. Admin > Outils > Tester écriture Firebase
   Si ça crée testWrites dans Firestore, la sauvegarde marche.
6. Ensuite teste Ajout ligne, arrêt, véhicule, chauffeur, client.

Si erreur:
L'application affiche maintenant l'erreur Firebase exacte.

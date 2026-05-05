TRANSPORT LIVE DZ - VERSION FIREBASE GPS

INSTALLATION
1. Crée un projet Firebase.
2. Authentication > Sign-in method > active Email/Password.
3. Firestore Database > Create database.
4. Dans Firebase Project settings > Web app, copie firebaseConfig.
5. Colle la config dans firebase-config.js.
6. Firestore Rules : copie le contenu de firestore.rules dans Firebase > Firestore > Rules > Publish.
7. Ouvre le site, crée ton compte admin.
8. Dans Firestore > collection users > ton UID > modifie role = admin.
9. Retourne dans Admin > Outils > Ajouter données démo Béjaïa.

COLLECTIONS FIRESTORE
users: role admin/driver
lines: lignes bus/tram/metro
stops: arrêts avec lat/lng
vehicles: véhicules avec GPS live
reports: futurs signalements clients

OPTIMISATION COÛT
GPS par défaut chaque 30 secondes.
Firestore lit seulement les véhicules actifs.
Les arrêts/lignes sont simples et légers.

IMPORTANT
Pour GPS sur iPhone/Android, le site doit être en HTTPS, donc Netlify/Firebase Hosting/GitHub Pages.


IMPORTANT CONNEXION ADMIN
1. Firebase > Authentication > Sign-in method > active Email/Password.
2. Firebase > Authentication > Settings > Authorized domains:
   ajoute allaouaboucheneb04-lgtm.github.io
3. Crée ton utilisateur dans Authentication.
4. Copie son UID.
5. Firestore > Données > Commencer une collection:
   Collection: admins
   Document ID: TON_UID
   Champs:
   - email : ton email
   - role : admin
   - active : true
   - name : Allaoua
6. Firestore > Sécurité: colle le contenu de firestore.rules puis Publier.

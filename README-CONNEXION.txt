Correction finale connexion Firebase:
- firebase-config.js est maintenant en format module: export const firebaseConfig.
- app.js importe correctement la configuration.
- index.html charge app.js avec type="module".

À vérifier dans Firebase:
1. Authentication > Sign-in method > Email/Password = Activé.
2. Authentication > Settings > Authorized domains:
   - allaouaboucheneb04-lgtm.github.io
   - localhost
3. Authentication > Users: ton email existe.
4. Firestore > admins > TON_UID:
   active = true
   role = admin

Après upload GitHub Pages:
ouvre avec ?v=10 pour casser le cache.

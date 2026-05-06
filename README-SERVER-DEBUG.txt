Diagnostic serveur Firestore.

Après upload ouvre:
  /Transport-Dz-Live/?v=server-debug-1

Regarde le panneau:
- projectId réel du site
- auth email
- auth uid
- lines serveur trouvées
- stops serveur trouvés

S'il affiche lines serveur trouvées: 0 alors le document n'est pas dans la base/projet que le site lit.
S'il affiche une erreur permission-denied, c'est rules.
S'il affiche tes documents, c'est l'affichage normal qui doit être corrigé.

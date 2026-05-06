Ajout espace chauffeur:
- Bouton Se mettre en ligne
- Bouton Hors ligne
- GPS chauffeur envoie la position au véhicule
- status online/offline
- visibleToClients true seulement si:
  1) véhicule online
  2) GPS récent moins de 2 minutes
  3) véhicule à moins de 500m des arrêts de sa ligne
- Si le chauffeur sort de sa ligne, il reste connecté mais disparaît des clients.

Après upload:
1. Publie firestore.rules
2. Ouvre /Transport-Dz-Live/?v=driver-online-1
3. Crée ligne + arrêts + chauffeur + véhicule
4. Page Chauffeur > choisir véhicule > Se mettre en ligne

const admin = require('firebase-admin');

admin.initializeApp({
  projectId: 'demcalendar-a9010'
});

async function configureManager() {
  const email = 'leadtoshopsl@gmail.com';
  
  try {
    // Verificar si existe
    const user = await admin.auth().getUserByEmail(email);
    console.log('Usuario encontrado:', user.uid);
    
    // Asignar custom claim
    await admin.auth().setCustomUserClaims(user.uid, {
      role: 'manager'
    });
    
    console.log('✅ Custom claim "manager" asignado');
    
    // Forzar refresh
    await admin.auth().revokeRefreshTokens(user.uid);
    console.log('✅ Tokens revocados (forzará refresh en próximo login)');
    
  } catch (error) {
    console.error('Error:', error.message);
  }
  
  process.exit();
}

configureManager();

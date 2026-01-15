function debugEventDescription() {
  const eventId = 'e5pf199sv8oorct2hef4pfe5ac';
  const event = Calendar.Events.get(CALENDAR_ID, eventId);
  
  Logger.log('=== EVENT DESCRIPTION ===');
  Logger.log('Length: ' + (event.description ? event.description.length : 0));
  Logger.log('Content:');
  Logger.log(event.description);
  Logger.log('=== END DESCRIPTION ===');
  
  const guests = parseGuestsFromDescription(event.description);
  Logger.log('Parsed guests: ' + guests.length);
  Logger.log(JSON.stringify(guests));
}
function getRootFolderId() {
  const folders = DriveApp.getFoldersByName('Tickets - Madrid Tours');
  if (folders.hasNext()) {
    const folder = folders.next();
    Logger.log('URL: ' + folder.getUrl());
    Logger.log('ID: ' + folder.getId());
  } else {
    Logger.log('Carpeta no existe aún');
  }
}
function getApiKeyFingerprint() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('API_KEY') || '';
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    apiKey,
    Utilities.Charset.UTF_8
  );
  const hex = digest.map(function (b) {
    const value = (b + 256) % 256;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');
  Logger.log('API_KEY_SHA256=' + hex);
  return hex;
}

// One-time import of holdings from the standalone FortPolio app's
// password-encrypted blob (ENCRYPTED_HOLDINGS in that repo's
// js/data.js). Decryption happens entirely in this browser -- the
// password typed into the import dialog never leaves the page, same
// AES-256-GCM + PBKDF2 scheme FortPolio's own js/core/crypto.js already
// used. The blob itself is safe to embed here: it's already ciphertext,
// useless without the password.

const ENCRYPTED_HOLDINGS = {
  salt: "VtBEYJLoSikaEi0yGpCt4A==",
  iv: "YFO14q2/uPkm8Wa0",
  iterations: 100000,
  ct: "xu+qpXIgU8y1cE10LmSos4zFNsXLhojZUYBF7gtZusL4WYf+OJ4tNl4oRs4CVCSv2wRwOj0KNmWG5cLHg9+3D0G7/1w+GlX4Vmor6sNxwJ2ordgVuawbmaMPHR9+wW5QjaweYz4GvRDqloq6V2hk1Lt6A4aH8kmzY/hlqFS9kcvyIuRSJQEXMBtNFCx37mmLDafW3posPLGCS6diMiAbCIRyEFXw8XTWnpyJ6pldR7hGtEVaMHEo8+HREbLDmMfsGgJ1QKb8UvoLrjJvc/DUazfUTQiQSl6gpvcrfJKcgOOSH6ZcuBb0dTvu+5/RoRFEBg6AHeo3K33uzh7U5dc7Uh59roBuPHJtoFJKHXd4kgUH1U92Jf1UagF2TsnGKOS1wOraIsOsDbvrCz7H6XFx8QspE8NNgS76Np4LebCpt5dLhmKtko68w747ZGolKKBvsaU/utIVXZWkhY+qTUVCld/69TESUXcEFissT9UtiFL/zXxiWXDjyRk6T5RI0lwRWrU/GoJgd+l5+N+RgdXs/t/yGQePihb518wtdWRal9reHlExgE9vYoWUre5pzKLHQwcY9N2vwCPcXniIylXNBDZdXMX2WxoMkLWzBL+lRudkRB+WlAZYoGLhR7AthOpMzhBXAjYO7TV3+9eKTSqmMQp57VyKxs9w578iSqAg2GVUOQLf9XzEF8rFqJAo5sUscbqr8McGs0x0aHqqo9+cdikfBoMuQ2DktmDnxoaoVqyjF2ZkyjJdgKS78QoL6mJTmHEW+amXM58sam8y5GwGuipcj9x08I0U5mkhuBETuKv0t2UMG01XTO7LjUuDCExtTFWOxLikIKLdtsfHcNdHMYtNUvB68xElKIEwgvuiC7emd/YAnCiBnmpkPZBAU4SvwtN9WIZjPl3IEi27CGNqAN8Zsif8EIzZnUNu4zbsVijHGdReqC/Z89Mkpl0D75OdqyTSGEj1+syM2A40TNkaOhUrrr/H1SIN1D6JvoLiUKSqXqTVq7btNmlOwk9yDUCsz84QY+wQz4dJIRmI8D7raH7shkUlK3M2QqUD+Mlqh7/qWYN+stObhg2hG1hxQsbQ3U3GvZR3PBd+XNBlg9T7gikiF1E87a6Tit/8TmI21BifvYsqYwiToOEHkV0axKiWz+Y9AL9ayRIVyQ0mial7JwbCc0V9IEGdidhRHKuNixTcsjKyIE7IS8LDfzhWSrqIa9ulWqmsYGG3cnEEod1WUzwxNxZPrM0KE0W4oXVZ7PhwxqEfRRia6B3MMiLDBbf7vaC2rgJlsgZuLj6T9KCEEs9vLAdBy1+JGvBvQTTPMi4awaVCSO1lLnDKhiyMq3QwaWFJg4d0bMFhM9m3NPghVU/rs5TwHX/44w9y+He1e95hM1ksj97buaMzCTSXZRK+GmdkX2kLiPNRpX8PCuRHRGK/F4VJQM7COUDBJiON7bR2xMsl1/iZnWGa9j3DteKy/r2bYrgmd8NwHVCeEL0BIv/cMvRrwA9kc8J7f/Ylj0w8Ryr5D9NMioBF69T3vPghTrl9PPncrUvuiyyq3ObgwoqGK7vpaFp9ieq95KEuRzCC6YTwZR3kAd1tpMceCNBCMicRqFKcOIhcm+X9g1lNPHzLDzEn9H/y6D2QtO4bhPP36Wv7ax3/Mu9jOeCHERCROxp4ypv5fpEjC9PtyrbB4k3s/QsaDdIbg+mOFcfQBs72aNBweKw8dk02yBhu9reeugG9HpM9Q5RZP7ib0lnSEEDPLvp2p0XVM8LKcZ4+/3etQdAh9vD2G40ZFhkoCDrJ8AxzUnxpruXqj/GC9qbAGT7cEDPmpRUSz9wjYS4LTMQxP+RyZlS9bntnDkUbdUZ0fyBjDbbxoY4PRoZT9VXgMfMLlsz7/WaZk4D49upqxO3hq2A+vac/O+xOZxerTwKBQZ3gf7tTLA1lpbacEH6MPN3WW5RfVg+s+og1C2+vNUyp2UOS0FnhQbfJ1RtreN+irtrtYdmJ6SHvWDke1g+O7OVrGA8688tsK/O7tuI0cV4Eps8B3XzMxbp8RtL8ZcMRmhgC9mpLbKzLh2fmf1fdHMuohcrlS/+USZIpvLDIzBCNuvRKjpnWrQ+jsEaQJCPWuzvm2KsnEscehYr7aREAeewu1SAnNNwmIeC8N2Iu93SOiwVo8O1R4quPMZatKlXO654aCqK9tf2Z4Rptqc/UrUd9HqgVDDdhWUgA/G/HpHsuBKuxt1993WggPq672NVUQ4T4vIWHUoAx5eDNWNRCYK5P7kil6kdS5z3Y/rswrBTgjllbMm4dYy1MNUr4E/vINVuHIXb54CFtEok560/PWD73LD3jaURu+o7KTEWLDDfnpHAu7HrIo7URfMrjnfu8bRF+ZlArEjjmSIrOkjYQh9V2e25Yqq9crua2h8alerfKyzeCZdc4BiaML2DeZWvsZnPPNvifRg4+3YFF0xaLsAmjH+JvNNrBrT/g/ZReW5ilGIlqOoAkVjSHzBLfKxsvE1wZBe2SFoSNp5nMvZMTVE1FgLhfJSCACJr0cRKwm2uTeUc8ic86Zqo3Q86so/2+NuNyDgbfgOoO8zq/apfnLvVOx3CFU/ATLWQx6dOfxnUrk+HeTeCs/0k8MNtK8e0pS4uqv+efWPbPi/5LHaMESL1lQssWOYEy+TEzqXPJqCiN7VC5NDyeyAzZ3boEKwklsRVgAZ2Jz/WGHhvbhIAfizZ5ZzPl1n8nj+coQ1t3QP2h8Ju/YJNisYCRPH1hFUxe12fUD7MCtLLA8EUm44B0NDwR5oalbaPnazg3e+kTry03rAVseEXRlgGpCYfSb3Q2D9I4xQ8cyfrn1ku6C9bq29O8eX3Fl1lTU4GEAiBLkSjzumpRH67yJTN3zldG/k3rILkaJoxAflBFeojrFxjl/w3N26m7Z63Dhs/2dqKcwxD22ZKweBbd2F6ru7J6yHIQi8P0yCayw7ODZrG2k4MIv8LBXo/865s83wvw9EoP8WVqrjuMio5kZFwj6Bu6XfZ+dbjTYhJy73D0lzIrZ2LPdxS3a6TpXQPoAMXwKlCif+0V1Bb7JZHZGa+wDG8Gy4XB4vB6xKFzIKyC0c0+8NJ2X4bjyZ2wVuElTRR1lc3tpigi2aW8NsnX8U55mCsSrf7YHWod4DsVvmQ07h6mSybJT1YBquXVQvXYTA8CkEvFyuQfS70JYuQltXus4WfXJaPg1LahQwp3pQiK5IEQeXxUuKiO7vQAgC70UBm2t2RpsL2veKrM0eouiMqyaRroOtGcWbdSLD3aeMyxJYC0uVCkLGEh1HBNSUhYkwI2TCtubmRrlnyrxavGR90VJQcmQh5YJ0H8ziQNjg=="
};

async function b64ToBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function deriveKey(password, saltB64, iterations) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: await b64ToBytes(saltB64), iterations, hash: "SHA-256" },
    keyMaterial, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
  );
}

// Throws (wrong password / corrupt data) rather than returning null, so
// the caller can show "Fel lösenord" the same way FortPolio's lock
// screen did.
export async function decryptFortPolioHoldings(password) {
  const key = await deriveKey(password, ENCRYPTED_HOLDINGS.salt, ENCRYPTED_HOLDINGS.iterations);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: await b64ToBytes(ENCRYPTED_HOLDINGS.iv) },
    key, await b64ToBytes(ENCRYPTED_HOLDINGS.ct)
  );
  return JSON.parse(new TextDecoder().decode(plainBuf));
}

// Maps FortPolio's { STOCKS, FUNDS } shape onto this module's doc.stocks
// / doc.funds (same fields, lowercase to match the rest of this module).
export function mapImportedHoldings({ STOCKS, FUNDS }) {
  const stocks = (STOCKS || []).map((s) => ({
    symbol: s.symbol || "",
    name: s.name,
    land: s.land,
    tags: s.tags || [],
    gav: s.gav || 0,
    antal: s.antal || 0,
    curr: s.curr || "SEK",
    guess: !!s.guess,
  }));
  const funds = (FUNDS || []).map((f) => ({
    name: f.name,
    varde: f.varde || 0,
    kostnad: f.kostnad || 0,
  }));
  return { stocks, funds };
}

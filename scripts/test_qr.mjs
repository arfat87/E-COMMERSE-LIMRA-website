import QRCode from 'qrcode';

async function test() {
  const upiUrl = 'upi://pay?pa=limra@upi&pn=LIMRA%20RESTAURANT&am=471.50&cu=INR&tn=Bill_108';
  const dataUrl = await QRCode.toDataURL(upiUrl, {
    width: 140,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#000000',
      light: '#ffffff'
    }
  });
  console.log("Generated Data URL length:", dataUrl.length);
  console.log("Starts with:", dataUrl.slice(0, 30));
}

test().catch(console.error);

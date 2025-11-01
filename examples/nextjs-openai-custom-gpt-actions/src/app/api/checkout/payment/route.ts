import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const plan = url.searchParams.get('plan') || 'pro';
  const returnUrl = url.searchParams.get('return_url') || '';
  const userId = url.searchParams.get('user_id') || 'user_1';

  const planDetails = {
    pro: { name: 'PRO Plan', price: '$29/month' },
    enterprise: { name: 'ENTERPRISE Plan', price: '$99/month' }
  };

  const selectedPlan = planDetails[plan as keyof typeof planDetails] || planDetails.pro;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Confirm Your Payment</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        .payment-card { border: 2px solid #007cba; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .plan-name { font-size: 24px; font-weight: bold; color: #007cba; margin-bottom: 10px; }
        .plan-price { font-size: 32px; font-weight: bold; margin-bottom: 15px; }
        .payment-details { background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .payment-details h3 { margin-top: 0; color: #333; }
        .payment-details p { margin: 5px 0; }
        .confirm-btn { background: #28a745; color: white; padding: 15px 30px; border: none; border-radius: 5px; font-size: 18px; cursor: pointer; margin: 10px; }
        .confirm-btn:hover { background: #218838; }
        .back-btn { background: #6c757d; color: white; padding: 15px 30px; border: none; border-radius: 5px; font-size: 18px; cursor: pointer; margin: 10px; text-decoration: none; display: inline-block; }
        .back-btn:hover { background: #5a6268; }
        .demo-note { background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 5px; padding: 15px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <h1>Confirm Your Payment</h1>
      
      <div class="payment-card">
        <div class="plan-name">${selectedPlan.name}</div>
        <div class="plan-price">${selectedPlan.price}</div>
      </div>
      
      <div class="payment-details">
        <h3>Payment Details</h3>
        <p><strong>Plan:</strong> ${plan.toUpperCase()}</p>
        <p><strong>Amount:</strong> ${selectedPlan.price}</p>
        <p><strong>Billing:</strong> Monthly subscription</p>
        <p><strong>Payment Method:</strong> Demo Credit Card ending in 4242</p>
      </div>
      
      <div class="demo-note">
        <strong>Demo Mode:</strong> This is a demonstration payment confirmation. 
        In a real implementation, this would show actual payment details and integrate with your payment processor.
      </div>
      
      <div style="text-align: center; margin-top: 30px;">
        <button class="confirm-btn" onclick="confirmPayment()">Confirm Payment</button>
        <a href="/api/checkout?plan=${plan}&return_url=${returnUrl}&user_id=${userId}" class="back-btn">← Back to Plan</a>
      </div>
      
      <script>
        function confirmPayment() {
          // Show loading state
          const btn = document.querySelector('.confirm-btn');
          btn.textContent = 'Processing...';
          btn.disabled = true;
          
          // Simulate payment processing
          setTimeout(() => {
            // Use the user_id from URL parameters, or default to user_1 for demo
            const userId = '${userId}';
            window.location.href = '/api/checkout/complete?plan=${plan}&return_url=${returnUrl}&user_id=' + userId;
          }, 1500);
        }
      </script>
    </body>
    </html>
  `;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' }
  });
}

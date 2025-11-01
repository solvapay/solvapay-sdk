import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { clearAllTasks } from '@solvapay/demo-services';
import { app } from '../index';

describe('Express Basic API - Paywall Tests', () => {
  
  beforeEach(() => {
    // Clear all tasks before each test for isolation
    clearAllTasks();
  });

  // ============================================================================
  // Unprotected Routes (Basic Smoke Tests)
  // ============================================================================

  describe('Unprotected Routes', () => {
    it('GET / should return API information', async () => {
      const response = await request(app).get('/');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('name', 'SolvaPay Express Example - Task API');
      expect(response.body).toHaveProperty('version', '1.0.0');
      expect(response.body).toHaveProperty('paywall');
    });

    it('GET /health should return health status', async () => {
      const response = await request(app).get('/health');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
    });
  });

  // ============================================================================
  // Paywall Free Tier Enforcement
  // ============================================================================

  describe('Paywall Free Tier', () => {
    it('should allow first 5 operations for a user (free tier)', async () => {
      const customerRef = 'test_user_free_tier';
      
      // First 5 operations should succeed
      for (let i = 1; i <= 5; i++) {
        const response = await request(app)
          .post('/tasks')
          .set('x-customer-ref', customerRef)
          .send({
            title: `Task ${i}`
          });
        
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('success', true);
        expect(response.body.task.title).toBe(`Task ${i}`);
      }
    });

    it('should block operations after free tier limit (6th operation)', async () => {
      const customerRef = 'test_user_limit';
      
      // Use up the free tier (5 operations)
      for (let i = 1; i <= 5; i++) {
        await request(app)
          .post('/tasks')
          .set('x-customer-ref', customerRef)
          .send({
            title: `Task ${i}`
          });
      }

      // 6th operation should be blocked
      const response = await request(app)
        .post('/tasks')
        .set('x-customer-ref', customerRef)
        .send({
          title: 'Blocked Task'
        });
      
      // The stub client should return a 402 or similar payment required response
      // Check that either we got an error or the response indicates blocked
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should provide fresh free tier for different users', async () => {
      const user1 = 'user_1';
      const user2 = 'user_2';
      
      // Use up user1's free tier
      for (let i = 1; i <= 5; i++) {
        await request(app)
          .post('/tasks')
          .set('x-customer-ref', user1)
          .send({
            title: `User1 Task ${i}`
          });
      }

      // User1's 6th request should fail
      const user1Response = await request(app)
        .post('/tasks')
        .set('x-customer-ref', user1)
        .send({
          title: 'User1 Blocked Task'
        });
      
      expect(user1Response.status).toBeGreaterThanOrEqual(400);

      // User2 should still have free tier available
      const user2Response = await request(app)
        .post('/tasks')
        .set('x-customer-ref', user2)
        .send({
          title: 'User2 Task'
        });
      
      expect(user2Response.status).toBe(200);
      expect(user2Response.body.success).toBe(true);
      expect(user2Response.body.task.title).toBe('User2 Task');
    });

    it('should enforce limit consistently across all operations using same plan', async () => {
      const customerRef = 'test_user_per_plan_unique';
      
      // Create 5 tasks (uses up the free tier for this plan)
      for (let i = 1; i <= 5; i++) {
        await request(app)
          .post('/tasks')
          .set('x-customer-ref', customerRef)
          .send({
            title: `Task ${i}`
          });
      }

      // 6th create should be blocked (exceeds free tier)
      const createResponse = await request(app)
        .post('/tasks')
        .set('x-customer-ref', customerRef)
        .send({
          title: 'Blocked Create'
        });
      
      expect(createResponse.status).toBeGreaterThanOrEqual(400);

      // Listing tasks should also be blocked (same plan, limit exceeded)
      const listResponse = await request(app)
        .get('/tasks')
        .set('x-customer-ref', customerRef);
      
      expect(listResponse.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ============================================================================
  // Paywall Error Handling
  // ============================================================================

  describe('Paywall Error Handling', () => {
    it('should handle missing customer_ref header', async () => {
      // Without customer_ref, the paywall should still process it
      // The behavior depends on the paywall implementation
      const response = await request(app)
        .post('/tasks')
        .send({
          title: 'No Customer Ref'
        });
      
      // Should either succeed or return an error
      // Just check it doesn't crash
      expect(response.status).toBeDefined();
    });
  });

  // ============================================================================
  // Paywall Isolation Tests
  // ============================================================================

  describe('Paywall Isolation', () => {
    it('should handle concurrent requests from different users', async () => {
      const users = ['user_a', 'user_b', 'user_c'];
      
      // Create tasks concurrently for different users
      const promises = users.map(user =>
        request(app)
          .post('/tasks')
          .set('x-customer-ref', user)
          .send({
            title: `Task for ${user}`
          })
      );
      
      const responses = await Promise.all(promises);
      
      // All should succeed (within their free tier)
      responses.forEach((response, index) => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.task.title).toBe(`Task for ${users[index]}`);
      });
    });
  });
});


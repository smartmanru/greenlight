import { expect } from 'chai'
import profileController from '../src/controller/profile'
import Http from '../src/lib/http'
import https from 'https'
import { EventEmitter } from 'events'

describe('NoFriends: profileController.getFriendsList', () => {
    it('returns empty people list without calling Xbox Friends API', async () => {
        const controller = new profileController()
        const result = await controller.getFriendsList({
            uhs: 'test-uhs',
            token: 'test-token',
        } as any)

        expect(result).to.deep.equal({
            data: {
                people: [],
            },
        })
    })
})

describe('JSON hardening: platform Http', () => {
    class FakeIncomingMessage extends EventEmitter {
        statusCode: number
        headers: Record<string, string>

        constructor(statusCode: number, headers: Record<string, string> = {}) {
            super()
            this.statusCode = statusCode
            this.headers = headers
        }
    }

    it('rejects corrupted JSON as a controlled error', async () => {
        const original = https.request
        ;(https as any).request = (_options: any, cb: any) => {
            const req = new EventEmitter() as any
            req.write = () => undefined
            req.end = () => {
                const res = new FakeIncomingMessage(200)
                process.nextTick(() => {
                    res.emit('data', Buffer.from('{"unterminated":'))
                    res.emit('close')
                })
                cb(res)
            }
            return req
        }

        const http = new Http()
        try {
            await http.getRequest('example.test', '/api', { Authorization: 'Bearer SECRET' })
            expect.fail('expected rejection')
        } catch (error: any) {
            expect(String(error.message)).to.match(/Invalid JSON|JSON\.parse failed/i)
            expect(String(error.message)).to.not.include('SECRET')
        } finally {
            ;(https as any).request = original
        }
    })
})

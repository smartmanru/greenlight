import { expect } from 'chai'
import fs from 'fs'
import path from 'path'
import Module from 'module'
import { EventEmitter } from 'events'

import xboxWorker from '../../main/helpers/xboxWorker'
import { safeParseJsonResponse, sanitizeHeaders } from '../../main/helpers/safeJson'

describe('NoFriends: xboxWorker', () => {
    it('does not schedule Friends polling timers', () => {
        const timers: NodeJS.Timeout[] = []
        const originalSetInterval = global.setInterval
        ;(global as any).setInterval = (...args: any[]) => {
            const handle = originalSetInterval.apply(global, args as any)
            timers.push(handle)
            return handle
        }

        try {
            const worker = new xboxWorker({} as any)
            expect(timers).to.have.length(0)
            expect(worker._onlineFriends).to.deep.equal([])
            expect(worker._friends).to.deep.equal({})
        } finally {
            ;(global as any).setInterval = originalSetInterval
            for (const timer of timers) {
                clearInterval(timer)
            }
        }
    })

    it('updateFriends resolves empty data without calling people API', async () => {
        const app: any = {
            _webApi: {
                providers: {
                    people: {
                        getFriends: async () => {
                            throw new Error('Friends API must not be called')
                        },
                    },
                },
            },
        }

        const worker = new xboxWorker(app)
        const friends = await worker.updateFriends()
        expect(friends).to.deep.equal({})
        expect(worker._onlineFriends).to.deep.equal([])
    })
})

describe('NoFriends: IPC getOnlineFriends', () => {
    it('always returns an empty array', async () => {
        const getOnlineFriends = () => Promise.resolve([])
        const result = await getOnlineFriends()
        expect(result).to.be.an('array').that.is.empty
    })
})

describe('NoFriends: source guarantees', () => {
    it('xboxWorker source no longer calls getFriends', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '../../main/helpers/xboxWorker.ts'),
            'utf8',
        )
        expect(src).to.not.match(/providers\.people\.getFriends/)
        expect(src).to.not.match(/setInterval/)
        expect(src).to.match(/Friends API/i)
    })

    it('sidebar friends component does not poll getOnlineFriends', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '../../renderer/components/sidebar/friends.tsx'),
            'utf8',
        )
        expect(src).to.not.match(/getOnlineFriends/)
        expect(src).to.not.match(/setInterval/)
    })

    it('ipc getOnlineFriends always resolves empty array', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '../../main/ipc/app.ts'),
            'utf8',
        )
        expect(src).to.match(/Friends API disabled/)
        expect(src).to.match(/Promise\.resolve\(\[\]\)/)
    })
})

describe('JSON hardening: safeParseJsonResponse', () => {
    it('parses valid JSON', () => {
        const result = safeParseJsonResponse('{"ok":true}', { url: 'example.test/api', status: 200 })
        expect(result.ok).to.equal(true)
        if(result.ok){
            expect(result.value).to.deep.equal({ ok: true })
        }
    })

    it('returns controlled error for corrupted JSON (no unhandled throw)', () => {
        const logs: any[] = []
        const result = safeParseJsonResponse('{bad', {
            url: 'profile.xboxlive.com/users/me',
            status: 200,
        }, (message, details) => logs.push({ message, details }))

        expect(result.ok).to.equal(false)
        if(!result.ok){
            expect(result.error.message).to.equal('JSON.parse failed')
            expect(result.error.url).to.equal('profile.xboxlive.com/users/me')
            expect(result.error.status).to.equal(200)
            expect(result.error.errorType).to.equal('SyntaxError')
            expect(result.error.responseSize).to.be.greaterThan(0)
        }
        expect(logs[0].details).to.not.have.property('body')
        expect(JSON.stringify(logs)).to.not.match(/Authorization|Bearer|cookie/i)
    })

    it('sanitizeHeaders redacts secrets', () => {
        const sanitized = sanitizeHeaders({
            Authorization: 'Bearer SECRET',
            'Content-Type': 'application/json',
            Cookie: 'session=abc',
        })
        expect(sanitized.Authorization).to.equal('[redacted]')
        expect(sanitized.Cookie).to.equal('[redacted]')
        expect(sanitized['Content-Type']).to.equal('application/json')
    })
})

describe('JSON hardening: patched xbox-webapi Http', () => {
    it('rejects corrupted JSON without unhandled rejection', function(done) {
        class FakeIncomingMessage extends EventEmitter {
            statusCode = 200
            headers = { 'content-type': 'application/json' }
        }

        const https = require('https')
        const originalRequest = https.request
        https.request = (_options: any, cb: any) => {
            const req = new EventEmitter() as any
            req.write = () => undefined
            req.end = () => {
                const res = new FakeIncomingMessage()
                cb(res)
                process.nextTick(() => {
                    res.emit('data', Buffer.from('{unterminated'))
                    res.emit('close')
                })
            }
            return req
        }

        // Force fresh load of patched module after https mock is in place.
        const httpPath = require.resolve('xbox-webapi/dist/lib/http')
        delete require.cache[httpPath]
        const Http = require('xbox-webapi/dist/lib/http').default

        let unhandled: any = null
        const onUnhandled = (reason: any) => {
            unhandled = reason
        }
        process.on('unhandledRejection', onUnhandled)

        const http = new Http()
        http.getRequest('example.test', '/profile', { Authorization: 'Bearer SECRET_TOKEN' })
            .then(() => {
                done(new Error('expected rejection'))
            })
            .catch((error: any) => {
                try {
                    expect(String(error.message)).to.match(/Invalid JSON|JSON\.parse failed/i)
                    expect(String(error.message)).to.not.include('SECRET_TOKEN')
                    expect(String(error.message)).to.not.include('{unterminated')
                    setTimeout(() => {
                        process.off('unhandledRejection', onUnhandled)
                        https.request = originalRequest
                        expect(unhandled).to.equal(null)
                        done()
                    }, 30)
                } catch (assertError) {
                    process.off('unhandledRejection', onUnhandled)
                    https.request = originalRequest
                    done(assertError)
                }
            })
    })

    it('rejects HTTP errors with sanitized details', function(done) {
        class FakeIncomingMessage extends EventEmitter {
            statusCode = 403
            headers = {
                authorization: 'Bearer leak',
                'content-type': 'application/json',
            }
        }

        const https = require('https')
        const originalRequest = https.request
        https.request = (_options: any, cb: any) => {
            const req = new EventEmitter() as any
            req.write = () => undefined
            req.end = () => {
                const res = new FakeIncomingMessage()
                cb(res)
                process.nextTick(() => {
                    res.emit('data', Buffer.from('{"error":"OfferingAccessDenied"}'))
                    res.emit('close')
                })
            }
            return req
        }

        const httpPath = require.resolve('xbox-webapi/dist/lib/http')
        delete require.cache[httpPath]
        const Http = require('xbox-webapi/dist/lib/http').default
        const http = new Http()

        http.getRequest('xgpuwebf2p.gssv-play-prod.xboxlive.com', '/v1/offering', {
            Authorization: 'Bearer SECRET',
        }).then(() => {
            https.request = originalRequest
            done(new Error('expected rejection'))
        }).catch((error: any) => {
            try {
                const msg = String(error.message)
                expect(msg).to.match(/403|Error fetching/i)
                expect(msg).to.not.include('SECRET')
                expect(msg).to.not.include('Bearer leak')
                expect(msg).to.include('[redacted]')
                expect(msg).to.include('bodySize')
                expect(msg).to.not.include('OfferingAccessDenied')
                https.request = originalRequest
                done()
            } catch (assertError) {
                https.request = originalRequest
                done(assertError)
            }
        })
    })

    it('propagates network timeouts as controlled rejections', function(done) {
        const https = require('https')
        const originalRequest = https.request
        https.request = () => {
            const req = new EventEmitter() as any
            req.write = () => undefined
            req.end = () => {
                process.nextTick(() => {
                    const err: any = new Error('connect ETIMEDOUT')
                    err.code = 'ETIMEDOUT'
                    req.emit('error', err)
                })
            }
            return req
        }

        const httpPath = require.resolve('xbox-webapi/dist/lib/http')
        delete require.cache[httpPath]
        const Http = require('xbox-webapi/dist/lib/http').default
        const http = new Http()

        http.getRequest('peoplehub.xboxlive.com', '/users/me/people/social', {})
            .then(() => {
                https.request = originalRequest
                done(new Error('expected rejection'))
            })
            .catch((error: any) => {
                try {
                    expect(String(error.message)).to.match(/ETIMEDOUT|Unhandled error/i)
                    https.request = originalRequest
                    done()
                } catch (assertError) {
                    https.request = originalRequest
                    done(assertError)
                }
            })
    })

    it('still resolves valid JSON for auth/profile-like responses', function(done) {
        class FakeIncomingMessage extends EventEmitter {
            statusCode = 200
            headers = {}
        }

        const https = require('https')
        const originalRequest = https.request
        https.request = (_options: any, cb: any) => {
            const req = new EventEmitter() as any
            req.write = () => undefined
            req.end = () => {
                const res = new FakeIncomingMessage()
                cb(res)
                process.nextTick(() => {
                    res.emit('data', Buffer.from(JSON.stringify({
                        profileUsers: [{ settings: [{ id: 'Gamertag', value: 'TestUser' }] }],
                    })))
                    res.emit('close')
                })
            }
            return req
        }

        const httpPath = require.resolve('xbox-webapi/dist/lib/http')
        delete require.cache[httpPath]
        const Http = require('xbox-webapi/dist/lib/http').default
        const http = new Http()

        http.getRequest('profile.xboxlive.com', '/users/me/profile/settings', {})
            .then((response: any) => {
                try {
                    expect(response.data.profileUsers[0].settings[0].value).to.equal('TestUser')
                    https.request = originalRequest
                    done()
                } catch (assertError) {
                    https.request = originalRequest
                    done(assertError)
                }
            })
            .catch((error: any) => {
                https.request = originalRequest
                done(error)
            })
    })
})

describe('Auth / Remote Play path source checks', () => {
    it('authenticationCompleted still creates webApi and xboxWorker', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '../../main/application.ts'),
            'utf8',
        )
        expect(src).to.match(/new xboxWorker\(this\)/)
        expect(src).to.match(/new xboxWebApi\(/)
        expect(src).to.match(/_xHomeApi\s*=\s*new xCloudApi/)
    })

    it('xCloud / Remote Play helpers remain present and hardened', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '../../main/helpers/xcloudapi.ts'),
            'utf8',
        )
        expect(src).to.match(/class xCloudApi/)
        expect(src).to.match(/safeParseJsonResponse/)
        expect(src).to.not.match(/peoplehub/)

        const safeJson = fs.readFileSync(
            path.join(__dirname, '../../main/helpers/safeJson.ts'),
            'utf8',
        )
        expect(safeJson).to.match(/JSON\.parse failed/)
    })

    it('patch-package patch exists for xbox-webapi', () => {
        const patchPath = path.join(__dirname, '../../../../patches/xbox-webapi+2.0.0-beta4.patch')
        expect(fs.existsSync(patchPath)).to.equal(true)
        const patch = fs.readFileSync(patchPath, 'utf8')
        expect(patch).to.match(/logJsonParseFailure/)
        expect(patch).to.match(/sanitizeHeaders/)
    })
})

// Silence unused import warning if Module unused in some Node versions
void Module
